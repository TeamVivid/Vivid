import { decipherStream, getPlayerEngine, getSignatureTimestamp, loadPlayer, withPot } from './decipher.js';
import { mintCynTokens, createColdStartCynToken, base64ToU8, u8ToBase64 } from './botguard.js';
import { getPlayerCode, discoverPlayerJsPath, decipherFormat } from './playerLoader.js';

export {
  decipherStream,
  getPlayerEngine,
  getSignatureTimestamp,
  loadPlayer,
  withPot,
  mintCynTokens,
  createColdStartCynToken,
  base64ToU8,
  u8ToBase64,
  getPlayerCode,
  discoverPlayerJsPath,
  decipherFormat
};

export async function resolveStreamWithCyn(playerKey, playerCode, fmt, videoId, visitorData, options = {}) {
  let cynResult = null;
  try {
    cynResult = await mintCynTokens(videoId, visitorData, { ...options, clientKey: playerKey });
  } catch {}

  const cynToken = cynResult?.playerCynToken || cynResult?.cynToken || null;
  const sabrCynToken = cynResult?.sabrCynToken || cynResult?.gvsCynToken || cynToken;
  const url = decipherStream(playerKey, playerCode, fmt, cynToken, playerKey, true);

  return {
    url,
    cynToken,
    sabrCynToken,
    poToken: cynToken,
    sabrPoToken: sabrCynToken,
    cynResult
  };
}

export default {
  decipherStream,
  getPlayerEngine,
  getSignatureTimestamp,
  loadPlayer,
  withPot,
  mintCynTokens,
  createColdStartCynToken,
  base64ToU8,
  u8ToBase64,
  getPlayerCode,
  discoverPlayerJsPath,
  decipherFormat,
  resolveStreamWithCyn
};
