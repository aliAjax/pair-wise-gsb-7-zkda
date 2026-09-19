// 领域模型：展项 / 导览机 / 借还记录 / 班次 / 维修单
// 设备状态不落库，统一由「未归还借据 + 未闭环维修单」派生，保证重新加载后一致。

export const LOW_BATTERY = 30;

export const seedExhibits = [
  { id: 1, title: '潮汐之后', room: 'A01 · 主展厅', type: '装置', desc: '一件记录海岸线变化的沉浸式影像装置。', audio: 'https://example.com/audio.mp3', status: '已发布', color: '#e6b45d' },
  { id: 2, title: '未寄出的信', room: 'B02 · 纸上时间', type: '档案', desc: '来自三代人的手写信件与声音档案。', audio: '', status: '草稿', color: '#ef8f84' },
  { id: 3, title: '柔软的边界', room: 'C01 · 新媒介', type: '互动', desc: '观众的移动会改变墙面上的光影。', audio: '', status: '已发布', color: '#83b9b1' },
];

export const seedShifts = [
  { id: 'S1', name: '早班', start: '09:00', end: '13:00' },
  { id: 'S2', name: '中班', start: '13:00', end: '17:00' },
  { id: 'S3', name: '晚班', start: '17:00', end: '21:00' },
];

export const seedDevices = [
  { sn: 'G-001', model: 'AG-200', battery: 92 },
  { sn: 'G-002', model: 'AG-200', battery: 28 },
  { sn: 'G-003', model: 'AG-200', battery: 67 },
  { sn: 'G-004', model: 'AG-200', battery: 54 },
  { sn: 'G-005', model: 'AG-100', battery: 15 },
];

const pad = (n) => String(n).padStart(2, '0');

export const uid = (p) =>
  p + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();

export function fmt(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function shiftAt(shifts, d = new Date()) {
  const t = d.getHours() * 60 + d.getMinutes();
  return shifts.find((s) => {
    const [sh, sm] = s.start.split(':').map(Number);
    const [eh, em] = s.end.split(':').map(Number);
    return t >= sh * 60 + sm && t < eh * 60 + em;
  }) || null;
}

export function shiftEndISO(shift, d = new Date()) {
  const [h, m] = shift.end.split(':').map(Number);
  const x = new Date(d);
  x.setHours(h, m, 0, 0);
  return x.toISOString();
}

export function toLocalInput(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function atOffset(hoursAgo, h, m, daysAgo = 0) {
  const d = new Date(Date.now() - hoursAgo * 3600e3);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

// 预置台账：一笔跨班交接中、一笔正常归档、一笔损坏转修（保留完整借还链）
export function buildSeedLoans() {
  const now = new Date();
  const borrowAt = new Date(now.getTime() - 3 * 3600e3).toISOString();
  const cur = shiftAt(seedShifts, now) || seedShifts[0];
  const from = shiftAt(seedShifts, new Date(borrowAt)) || cur;
  const handovers = from.id === cur.id ? [] : [{
    id: uid('H'),
    at: new Date(now.getTime() - 30 * 60e3).toISOString(),
    receiver: '何雯',
    fromShiftId: from.id,
    toShiftId: cur.id,
    expectedReturnAt: shiftEndISO(cur, now),
  }];
  return [
    {
      id: 'L-1001', sn: 'G-003', exhibitId: 1, receiver: '林晓', shiftId: from.id,
      borrowAt, expectedReturnAt: shiftEndISO(cur, now), returnAt: null,
      state: 'active', note: '', handovers, repairId: null,
    },
    {
      id: 'L-1002', sn: 'G-004', exhibitId: 3, receiver: '周远', shiftId: 'S3',
      borrowAt: atOffset(0, 10, 12, 3), expectedReturnAt: atOffset(0, 12, 0, 3),
      returnAt: atOffset(0, 12, 5, 3), state: 'damaged', note: '', handovers: [],
      repairId: 'RP-2001',
    },
    {
      id: 'L-1003', sn: 'G-001', exhibitId: 3, receiver: '陈默', shiftId: 'S1',
      borrowAt: atOffset(0, 9, 30, 1), expectedReturnAt: atOffset(0, 12, 30, 1),
      returnAt: atOffset(0, 12, 18, 1), state: 'returned', note: '', handovers: [],
      repairId: null,
    },
  ];
}

export function buildSeedRepairs() {
  const loans = buildSeedLoans();
  const damaged = loans.find((l) => l.id === 'L-1002');
  return [{
    id: 'RP-2001', sn: 'G-004', loanId: 'L-1002',
    reason: '右扬声器无声，机身右下角有磕碰痕',
    reportedAt: damaged.returnAt, resolvedAt: null,
  }];
}
