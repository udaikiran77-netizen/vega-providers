import { ProviderContext, Stream, TextTracks } from "../types";

const CINEJOY_ORIGIN = "https://cinejoy.pk";
const WING_API = "https://api2.wing.st";
const FALLBACK_SERVERS: Array<{ name: string; status?: string; "4k"?: boolean }> = [
  { name: "Light", "4k": true },
  { name: "Nebula" },
  { name: "Sirius", "4k": true },
  { name: "Polaris" },
];

let cachedServers: Array<{ name: string; status?: string; "4k"?: boolean }> = [
  ...FALLBACK_SERVERS,
];
let lastServerFetchTime = 0;
let cachedWasmBytes: Uint8Array | null = null;

// ---------------------------------------------------------------------------
// Byte helpers
// ---------------------------------------------------------------------------

function toUint8Array(rawData: any): Uint8Array {
  if (!rawData) return new Uint8Array(0);
  if (rawData instanceof Uint8Array) return rawData;
  if (rawData instanceof ArrayBuffer) return new Uint8Array(rawData);
  if (ArrayBuffer.isView(rawData)) {
    return new Uint8Array(rawData.buffer, rawData.byteOffset, rawData.byteLength);
  }
  if (typeof rawData === "string") return utf8Encode(rawData);
  if (Array.isArray(rawData)) return new Uint8Array(rawData);
  // Node-style Buffer JSON ({type:"Buffer",data:[...]}) from some transports
  if (rawData && Array.isArray(rawData.data)) return new Uint8Array(rawData.data);
  return new Uint8Array(0);
}

function utf8Encode(str: string): Uint8Array {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(str);
  }
  const out: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i);
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
      const lo = str.charCodeAt(++i);
      const cp = 0x10000 + ((code - 0xd800) << 10) + (lo - 0xdc00);
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f)
      );
    } else {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return new Uint8Array(out);
}

function utf8Decode(uint8: Uint8Array): string {
  if (typeof TextDecoder !== "undefined") {
    try {
      return new TextDecoder("utf-8").decode(uint8);
    } catch {}
  }
  let out = "";
  for (let i = 0; i < uint8.length; i++) {
    out += String.fromCharCode(uint8[i]);
  }
  return out;
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  const c: any = typeof crypto !== "undefined" ? crypto : undefined;
  if (c && typeof c.getRandomValues === "function") {
    c.getRandomValues(out);
    return out;
  }
  for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

// ---------------------------------------------------------------------------
// Pure-JS AES-256-GCM decryption (the wing.st gateway encrypts its response
// with AES-256-GCM; WebCrypto subtle is not available in every sandbox, so
// the decryption is done here directly).
// ---------------------------------------------------------------------------

const AES_SBOX: Uint8Array = (() => {
  function mul(a: number, b: number): number {
    let r = 0;
    while (b) {
      if (b & 1) r ^= a;
      a = ((a << 1) ^ (a & 0x80 ? 0x1b : 0)) & 0xff;
      b >>= 1;
    }
    return r;
  }
  function inv(a: number): number {
    if (a === 0) return 0;
    for (let i = 1; i < 256; i++) if (mul(a, i) === 1) return i;
    return 0;
  }
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const v = inv(i);
    s[i] =
      (v ^
        ((v << 1) | (v >> 7)) ^
        ((v << 2) | (v >> 6)) ^
        ((v << 3) | (v >> 5)) ^
        ((v << 4) | (v >> 4)) ^
        0x63) &
      0xff;
  }
  return s;
})();
const AES_RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36, 0x6c, 0xd8, 0xab, 0x4d];

function aes256ExpandKey(key: Uint8Array): Uint8Array {
  const Nk = 8;
  const Nr = 14;
  const w = new Uint8Array(16 * (Nr + 1));
  w.set(key);
  for (let i = Nk; i < 4 * (Nr + 1); i++) {
    let t = [w[4 * (i - 1)], w[4 * (i - 1) + 1], w[4 * (i - 1) + 2], w[4 * (i - 1) + 3]];
    if (i % Nk === 0) {
      t = [AES_SBOX[t[1]] ^ AES_RCON[i / Nk - 1], AES_SBOX[t[2]], AES_SBOX[t[3]], AES_SBOX[t[0]]];
    } else if (i % Nk === 4) {
      t = [AES_SBOX[t[0]], AES_SBOX[t[1]], AES_SBOX[t[2]], AES_SBOX[t[3]]];
    }
    for (let j = 0; j < 4; j++) w[4 * i + j] = w[4 * (i - Nk) + j] ^ t[j];
  }
  return w;
}

function aesEncryptBlock(w: Uint8Array, input: Uint8Array): Uint8Array {
  const Nr = 14;
  const s = new Uint8Array(16);
  for (let i = 0; i < 16; i++) s[i] = input[i] ^ w[i];
  const mul2 = (a: number) => ((a << 1) ^ (a & 0x80 ? 0x1b : 0)) & 0xff;
  function subBytes() {
    for (let i = 0; i < 16; i++) s[i] = AES_SBOX[s[i]];
  }
  function shiftRows() {
    const t = new Uint8Array(16);
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 4; c++) t[r + 4 * c] = s[r + 4 * ((c + r) % 4)];
    s.set(t);
  }
  function mixColumns() {
    for (let c = 0; c < 4; c++) {
      const a0 = s[4 * c], a1 = s[4 * c + 1], a2 = s[4 * c + 2], a3 = s[4 * c + 3];
      const x0 = mul2(a0), x1 = mul2(a1), x2 = mul2(a2), x3 = mul2(a3);
      s[4 * c] = x0 ^ (x1 ^ a1) ^ a2 ^ a3;
      s[4 * c + 1] = a0 ^ x1 ^ (x2 ^ a2) ^ a3;
      s[4 * c + 2] = a0 ^ a1 ^ x2 ^ (x3 ^ a3);
      s[4 * c + 3] = (x0 ^ a0) ^ a1 ^ a2 ^ x3;
    }
  }
  function addRound(r: number) {
    for (let i = 0; i < 16; i++) s[i] ^= w[16 * r + i];
  }
  for (let round = 1; round < Nr; round++) {
    subBytes();
    shiftRows();
    mixColumns();
    addRound(round);
  }
  subBytes();
  shiftRows();
  addRound(Nr);
  return s;
}

function ghash(H: Uint8Array, data: Uint8Array): Uint8Array {
  const x = new Uint8Array(16);
  for (let off = 0; off < data.length; off += 16) {
    for (let j = 0; j < 16; j++) x[j] ^= data[off + j];
    const z = new Uint8Array(16);
    const v = new Uint8Array(x);
    for (let i = 0; i < 128; i++) {
      if ((H[i >> 3] >> (7 - (i & 7))) & 1) {
        for (let j = 0; j < 16; j++) z[j] ^= v[j];
      }
      const lsb = v[15] & 1;
      for (let j = 15; j > 0; j--) v[j] = ((v[j] >> 1) | ((v[j - 1] & 1) << 7)) & 0xff;
      v[0] >>= 1;
      if (lsb) v[0] ^= 0xe1;
    }
    x.set(z);
  }
  return x;
}

function pad16(b: Uint8Array): Uint8Array {
  if (b.length % 16 === 0) return b;
  const out = new Uint8Array(b.length + (16 - (b.length % 16)));
  out.set(b);
  return out;
}

function aesGcmDecrypt(
  key: Uint8Array,
  iv: Uint8Array,
  ciphertextWithTag: Uint8Array,
  aad: Uint8Array
): Uint8Array {
  if (ciphertextWithTag.length < 16) throw new Error("ciphertext too short");
  const w = aes256ExpandKey(key);
  const H = aesEncryptBlock(w, new Uint8Array(16));
  const J0 = new Uint8Array(16);
  J0.set(iv.subarray(0, 12));
  J0[15] = 1;
  const ct = ciphertextWithTag.subarray(0, ciphertextWithTag.length - 16);
  const tagGiven = ciphertextWithTag.subarray(ciphertextWithTag.length - 16);
  const aadP = pad16(aad);
  const ctP = pad16(new Uint8Array(ct));
  const ghData = new Uint8Array(aadP.length + ctP.length + 16);
  ghData.set(aadP, 0);
  ghData.set(ctP, aadP.length);
  const dv = new DataView(ghData.buffer);
  dv.setUint32(ghData.length - 16, 0);
  dv.setUint32(ghData.length - 12, aad.length * 8);
  dv.setUint32(ghData.length - 8, 0);
  dv.setUint32(ghData.length - 4, ct.length * 8);
  const S = ghash(H, ghData);
  const EJ0 = aesEncryptBlock(w, J0);
  for (let i = 0; i < 16; i++) {
    if ((S[i] ^ EJ0[i]) !== tagGiven[i]) throw new Error("GCM tag mismatch");
  }
  const out = new Uint8Array(ct.length);
  const counter = new Uint8Array(J0);
  for (let off = 0; off < ct.length; off += 16) {
    let c =
      ((counter[12] << 24) | (counter[13] << 16) | (counter[14] << 8) | counter[15]) >>> 0;
    c = (c + 1) >>> 0;
    counter[12] = (c >> 24) & 0xff;
    counter[13] = (c >> 16) & 0xff;
    counter[14] = (c >> 8) & 0xff;
    counter[15] = c & 0xff;
    const ks = aesEncryptBlock(w, counter);
    const n = Math.min(16, ct.length - off);
    for (let j = 0; j < n; j++) out[off + j] = ct[off + j] ^ ks[j];
  }
  return out;
}

// ---------------------------------------------------------------------------
// wing.st gateway protocol (the same one the Cinejoy web player uses):
//   1. GET  /servers            -> server list
//   2. GET  /crush.wasm          -> request sealer (exports alloc/dealloc/seal_request)
//   3. seal_request(in, rand44) -> [0..32) response AES key, [98..) request body
//   4. POST /g  (text/plain)     -> iv(12) || AES-256-GCM ciphertext+tag
//   5. decrypt with AAD = "lumen-gate-v2" || 0x00 || body[0..67)
// ---------------------------------------------------------------------------

async function getWasmInstance(
  axios: any,
  headers: Record<string, string>,
  signal?: AbortSignal
): Promise<any> {
  if (typeof WebAssembly === "undefined") {
    throw new Error("WebAssembly unavailable");
  }
  if (!cachedWasmBytes) {
    const res = await axios.get(`${WING_API}/crush.wasm`, {
      headers,
      responseType: "arraybuffer",
      timeout: 15000,
      signal,
    });
    cachedWasmBytes = toUint8Array(res.data);
    if (!cachedWasmBytes.length) throw new Error("empty crush.wasm");
  }
  const bytes = cachedWasmBytes;
  if (typeof WebAssembly.instantiate === "function") {
    const out: any = await WebAssembly.instantiate(bytes, {});
    return out.instance || out;
  }
  const mod = await (WebAssembly as any).compile(bytes);
  return new (WebAssembly as any).Instance(mod, {});
}

function sealGatewayRequest(
  instance: any,
  plaintext: Uint8Array
): { respKey: Uint8Array; body: Uint8Array } {
  const { alloc, dealloc, seal_request, memory } = instance.exports;
  const rand = randomBytes(44);
  const inPtr = alloc(plaintext.length);
  const midPtr = alloc(44);
  const outCap = plaintext.length + 1024;
  const outPtr = alloc(outCap);
  try {
    let mem = new Uint8Array(memory.buffer);
    mem.set(plaintext, inPtr);
    mem.set(rand, midPtr);
    const outLen = seal_request(inPtr, plaintext.length, midPtr, 44, outPtr, outCap);
    if (!outLen || outLen <= 98 + 67) {
      throw new Error(`seal_request failed (${outLen})`);
    }
    mem = new Uint8Array(memory.buffer);
    const out = mem.slice(outPtr, outPtr + outLen);
    const body = out.slice(98);
    if (body[0] !== 0x02 || body[1] !== 0x02 || body[2] !== 0x04) {
      throw new Error("unexpected sealed body");
    }
    return { respKey: out.slice(0, 32), body };
  } finally {
    try {
      dealloc(inPtr, plaintext.length);
      dealloc(midPtr, 44);
      dealloc(outPtr, outCap);
    } catch {}
  }
}

async function resolveViaGateway({
  axios,
  headers,
  serverName,
  mediaKind,
  payload,
  signal,
}: {
  axios: any;
  headers: Record<string, string>;
  serverName: string;
  mediaKind: "movie" | "series";
  payload: Record<string, string>;
  signal?: AbortSignal;
}): Promise<any> {
  const instance = await getWasmInstance(axios, headers, signal);
  const plaintext = utf8Encode(
    JSON.stringify({ path: `/${serverName}/${mediaKind}`, payload })
  );
  const { respKey, body } = sealGatewayRequest(instance, plaintext);
  const res = await axios({
    url: `${WING_API}/g`,
    method: "POST",
    headers: { ...headers, "Content-Type": "text/plain;charset=UTF-8" },
    data: body,
    responseType: "arraybuffer",
    timeout: 15000,
    signal,
  });
  const resBytes = toUint8Array(res.data);
  if (resBytes.length <= 12 + 16) throw new Error("short gateway response");
  const iv = resBytes.slice(0, 12);
  const ctTag = resBytes.slice(12);
  const aad = new Uint8Array(14 + 67);
  aad.set(utf8Encode("lumen-gate-v2"), 0);
  aad[13] = 0;
  aad.set(body.subarray(0, 67), 14);
  const plain = aesGcmDecrypt(respKey, iv, ctTag, aad);
  return JSON.parse(utf8Decode(plain));
}

// ---------------------------------------------------------------------------

function mapCaption(c: any): TextTracks[number] | null {
  const uri = c?.url || c?.file;
  if (!uri) return null;
  const langRaw = c.language || c.lang || c.id || "en";
  return {
    title: c.display || c.label || c.language || c.lang || c.id || "Subtitle",
    language: String(langRaw).slice(0, 2).toLowerCase(),
    type:
      c.type === "vtt" || String(uri).endsWith(".vtt")
        ? "text/vtt"
        : "application/x-subrip",
    uri: String(uri),
  };
}

function raceWithTimeout<T>(
  promise: Promise<T>,
  ms: number,
  signal?: AbortSignal
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Aborted"));
      return;
    }
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error("Aborted"));
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      reject(new Error("Server timeout"));
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });

    promise.then(
      (val) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve(val);
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(err);
      }
    );
  });
}

export async function extractCinejoyStreams({
  tmdbId,
  imdbId,
  title,
  year,
  season,
  episode,
  type,
  providerContext,
  signal,
}: {
  tmdbId: string;
  imdbId?: string;
  title?: string;
  year?: string;
  season?: number | string;
  episode?: number | string;
  type: string;
  providerContext: ProviderContext;
  signal?: AbortSignal;
}): Promise<Stream[]> {
  const { axios, commonHeaders } = providerContext;
  const isMovie = type === "movie";
  const mediaKind: "movie" | "series" = isMovie ? "movie" : "series";

  if (!tmdbId) return [];

  const watchPath = `/watch/${isMovie ? "movie" : "tv"}/${tmdbId}${
    isMovie ? "" : `/${season || 1}/${episode || 1}`
  }`;

  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Origin: CINEJOY_ORIGIN,
    Referer: `${CINEJOY_ORIGIN}${watchPath}`,
    ...(commonHeaders || {}),
  };

  try {
    if (Date.now() - lastServerFetchTime > 300000) {
      try {
        const sRes = await axios.get(`${WING_API}/servers`, {
          headers,
          timeout: 8000,
          signal,
        });
        const list = Array.isArray(sRes.data)
          ? sRes.data
          : sRes.data?.servers;
        if (Array.isArray(list) && list.length) {
          const available = list.filter(
            (s: any) => s && s.name && s.status !== "offline"
          );
          if (available.length) {
            cachedServers = available;
            lastServerFetchTime = Date.now();
          }
        }
      } catch {}
    }

    const subPromise = (async (): Promise<TextTracks> => {
      try {
        const subUrl = `https://subs.wing.st/subtitles?tmdb=${tmdbId}${
          isMovie ? "" : `&season=${season || 1}&episode=${episode || 1}`
        }`;
        const subRes = await axios.get(subUrl, { headers, timeout: 8000, signal });
        const rawList = Array.isArray(subRes.data)
          ? subRes.data
          : Array.isArray(subRes.data?.subtitles)
          ? subRes.data.subtitles
          : [];
        return rawList
          .map(mapCaption)
          .filter((s: TextTracks[number] | null): s is TextTracks[number] =>
            Boolean(s)
          );
      } catch {
        return [];
      }
    })();

    const activeServers = (cachedServers || []).filter(
      (s) => s && s.name && s.status !== "offline"
    );

    const externalSubtitles = await subPromise;
    const streamHeaders = {
      Referer: `${CINEJOY_ORIGIN}/`,
      Origin: CINEJOY_ORIGIN,
      "User-Agent": headers["User-Agent"],
    };

    // Payload shape used by the Cinejoy web player, keys in the same order.
    const payload: Record<string, string> = { tmdb: String(tmdbId) };
    if (!isMovie) {
      payload.season = String(season || 1);
      payload.episode = String(episode || 1);
    }
    if (imdbId) payload.imdb = String(imdbId);
    if (year) payload.year = String(year);
    if (title) payload.title = String(title);

    const streams: Stream[] = [];
    const seenLinks = new Set<string>();

    const tasks = activeServers.map(async (srv) => {
      try {
        const json = await raceWithTimeout(
          resolveViaGateway({
            axios,
            headers,
            serverName: srv.name,
            mediaKind,
            payload,
            signal,
          }),
          40000,
          signal
        );
        const entries = Array.isArray(json?.data?.stream) ? json.data.stream : [];
        for (const entry of entries) {
          const playlist = entry?.playlist || entry?.url;
          if (!playlist) continue;
          const streamUrl = String(playlist);
          if (seenLinks.has(streamUrl)) continue;

          const streamType =
            entry.type === "hls" || streamUrl.includes(".m3u8")
              ? "m3u8"
              : entry.type || "mp4";

          if (streamType === "m3u8") {
            try {
              const playlistRes = await axios.get(streamUrl, {
                headers: streamHeaders,
                timeout: 8000,
                signal,
              });
              const text =
                typeof playlistRes.data === "string"
                  ? playlistRes.data
                  : utf8Decode(toUint8Array(playlistRes.data));
              if (!text.trimStart().startsWith("#EXTM3U")) {
                continue;
              }
            } catch {
              // Inconclusive check (network) - keep the stream, the
              // gateway already validated the server for this title.
            }
          }

          if (seenLinks.has(streamUrl)) continue;
          seenLinks.add(streamUrl);

          const rawSubs = [
            ...(Array.isArray(entry.captions)
              ? entry.captions
                  .map(mapCaption)
                  .filter(
                    (s: TextTracks[number] | null): s is TextTracks[number] =>
                      Boolean(s)
                  )
              : []),
            ...externalSubtitles,
          ];
          const seenSubs = new Set<string>();
          const subtitles: TextTracks = [];
          for (const s of rawSubs) {
            if (s.uri && !seenSubs.has(s.uri)) {
              seenSubs.add(s.uri);
              subtitles.push(s);
            }
          }

          streams.push({
            server: `Cinejoy - ${srv.name}${srv["4k"] ? " (4K)" : ""}`,
            link: streamUrl,
            type: streamType,
            quality: srv["4k"] ? "2160" : "1080",
            subtitles: subtitles.length ? subtitles : undefined,
            headers: streamHeaders,
          });
        }
      } catch {
        // Skip server if unavailable or timed out
      }
    });

    await Promise.allSettled(tasks);
    return streams;
  } catch (err) {
    console.log("extractCinejoyStreams error:", err);
    return [];
  }
}

export const getStream = async function ({
  link,
  type,
  signal,
  providerContext,
  isDownload,
}: {
  link: string;
  type: string;
  signal?: AbortSignal;
  providerContext: ProviderContext;
  isDownload?: boolean;
}): Promise<Stream[]> {
  try {
    let payload: any = {};
    try {
      payload = JSON.parse(link);
    } catch {
      payload = { tmdbId: link };
    }
    const streamType =
      payload.type === "series" || payload.type === "tv"
        ? "series"
        : payload.type === "movie"
          ? "movie"
          : type === "series"
            ? "series"
            : "movie";
    const streams = await extractCinejoyStreams({
      tmdbId: String(payload.tmdbId ?? payload.id ?? ""),
      imdbId: payload.imdbId || "",
      title: payload.title || "",
      year: payload.year ? String(payload.year) : "",
      season: payload.season,
      episode: payload.episode,
      type: streamType,
      providerContext,
      signal,
    });
    if (isDownload) {
      return streams.filter((stream) => !stream.drm);
    }
    return streams;
  } catch (err) {
    console.error("Cinejoy getStream error:", err);
    return [];
  }
};
