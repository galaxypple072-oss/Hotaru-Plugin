// Curated local performances. Only server-controlled paths are imported.
import { RUNTIME_CONFIG } from './runtime-config.js';
const ROOT = RUNTIME_CONFIG.coversRoot;
export const MUSIC_COVERS = ROOT ? [
  { key: 'inochi-afterglow-initial-v1', title: '命に嫌われている。', seconds: 274.1066667,
    diaryDate: '2026-10-16', mood: '日语翻唱 · Afterglow 版本',
    reason: '用 Afterglow 的人声导唱制作的汐见萤翻唱。',
    diaryText: '想把这首歌留在这里。等你想听的时候，我们再一起听吧。',
    credits: '原作：カンザキイオリ；导唱与编曲版本：Afterglow；角色换声：汐见萤。',
    audio: `${ROOT}/inochi-afterglow/output/hotaru-afterglow-full-initial.wav`,
    vocal: `${ROOT}/inochi-afterglow/output/hotaru-afterglow-full-initial-vocal.wav` },
  { key: 'tada-kimi-ni-hare-initial-v1', title: 'ただ君に晴れ', seconds: 198.9733333,
    diaryDate: '2026-10-16', mood: '日语翻唱', reason: '根据你提供的人声和伴奏制作的汐见萤翻唱。',
    diaryText: '把这段歌声也放进日记里，留给下一次想听歌的你。',
    credits: '曲目：ただ君に晴れ；导唱与伴奏：用户提供的分轨；角色换声：汐见萤。',
    audio: `${ROOT}/tada-kimi-ni-hare/output/hotaru-tada-kimi-ni-hare-full-initial.wav`,
    vocal: `${ROOT}/tada-kimi-ni-hare/output/hotaru-tada-kimi-ni-hare-full-initial-vocal.wav` },
] : [];
