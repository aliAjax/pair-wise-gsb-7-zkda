// 导览机借还台账：数据模型、持久化、业务规则与一致性审计（纯函数）

export const KEYS = {
  exhibits: 'guide-exhibits',
  devices: 'guide-devices',
  loans: 'guide-loans',
  handovers: 'guide-handovers',
  repairs: 'guide-repairs',
  shifts: 'guide-shifts',
};

// 触发规则（冲突与审计共用同一套文案）
export const RULES = {
  BATTERY: '电量低于三成（30%），不得借出',
  UNRETURNED: '存在未归还记录，同一设备不得重复借出',
  REPAIR: '设备处于维修中，不得借出',
  NOT_PUBLISHED: '导览机同一时段只能绑定「已发布」展项',
  OVERLAP: '同一时段一台导览机只能绑定一个展项（借出时段冲突）',
  BAD_TIME: '归还时间必须晚于借出时间',
  NO_RECEIVER: '跨班交接 / 借出必须登记领取人',
  UNPUBLISH: '撤展前必须先释放该展项下已借出的设备',
  DEVICE_EXISTS: '设备编号已存在',
  // 重新加载后的一致性审计规则
  MISSING_DEVICE: '借还记录引用了不存在的设备',
  MISSING_EXHIBIT: '借还记录引用了不存在的展项',
  BOUND_DRAFT: '未发布（草稿/已撤展）展项仍挂着未归还记录',
  DUP_OPEN: '同一设备存在多条未归还记录',
  LOAN_REPAIR: '设备同时处于「借出中」与「维修中」',
  INTERVAL_OVERLAP: '同一设备存在相互重叠的借出时段',
  BROKEN_CHAIN: '维修单丢失了原借还链（借还单不存在）',
  HANDOVER_LOST: '跨班交接记录关联的借还单不存在',
  HANDOVER_CODE: '交接记录的设备编号与借还单不一致',
};

const read = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

// ---- 种子数据（与展项种子的 id 对应：1 潮汐之后 已发布 / 2 未寄出的信 草稿 / 3 柔软的边界 已发布）----
export const seedShifts = [
  { name: '早班', hours: '08:00–13:00' },
  { name: '中班', hours: '13:00–18:00' },
  { name: '晚班', hours: '18:00–22:00' },
];

export const seedDevices = [
  { code: 'DG-001', model: 'AG-Pro', battery: 92 },
  { code: 'DG-002', model: 'AG-Pro', battery: 67 },
  { code: 'DG-003', model: 'AG-Lite', battery: 45 },
  { code: 'DG-004', model: 'AG-Lite', battery: 18 },
  { code: 'DG-005', model: 'AG-Pro', battery: 78 },
];

// 借还链：L0990（正常归还）→ L0998（归还损坏，转 R0201 维修，链路保留）
// L1001：DG-002 当前借出中，且发生过一次跨班交接（早班 王晨 → 中班 赵屿）
export const seedLoans = [
  {
    id: 'L0990', code: 'DG-005', exhibitId: 3, exhibitTitle: '柔软的边界',
    receiver: '李明', shift: '晚班', startAt: '2026-09-18T18:00', endAt: '2026-09-18T20:00',
    returnedAt: '2026-09-18T20:05', returnType: '正常归还', damaged: false, repairId: null,
    handovers: [], prevId: null,
  },
  {
    id: 'L0998', code: 'DG-005', exhibitId: 1, exhibitTitle: '潮汐之后',
    receiver: '王晨', shift: '早班', startAt: '2026-09-19T08:30', endAt: '2026-09-19T09:30',
    returnedAt: '2026-09-19T09:35', returnType: '损坏转修', damaged: true, repairId: 'R0201',
    handovers: [], prevId: 'L0990',
  },
  {
    id: 'L1001', code: 'DG-002', exhibitId: 1, exhibitTitle: '潮汐之后',
    receiver: '赵屿', shift: '中班', startAt: '2026-09-19T09:00', endAt: '2026-09-19T17:00',
    returnedAt: null, returnType: null, damaged: false, repairId: null,
    handovers: ['H0301'], prevId: null,
  },
];

export const seedHandovers = [
  {
    id: 'H0301', loanId: 'L1001', code: 'DG-002',
    fromReceiver: '王晨', fromShift: '早班',
    receiver: '赵屿', toShift: '中班',
    handedAt: '2026-09-19T13:00', returnAt: '2026-09-19T17:00',
  },
];

export const seedRepairs = [
  {
    id: 'R0201', code: 'DG-005', loanId: 'L0998',
    reason: '扬声器破音，归还时外壳有磕碰', at: '2026-09-19T09:40',
    status: '维修中', fixedAt: null,
  },
];

export const loadDevices = () => read(KEYS.devices, seedDevices);
export const loadLoans = () => read(KEYS.loans, seedLoans);
export const loadHandovers = () => read(KEYS.handovers, seedHandovers);
export const loadRepairs = () => read(KEYS.repairs, seedRepairs);
export const loadShifts = () => read(KEYS.shifts, seedShifts);

// ---- 时间 / 编号工具 ----
const pad = (n) => String(n).padStart(2, '0');
export const nowInput = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const plusHours = (s, h) => {
  const d = new Date(s);
  d.setHours(d.getHours() + h);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const fmt = (s) => (s ? s.replace('T', ' ').slice(5, 16) : '—');
export const fmtPeriod = (s, e) => `${fmt(s)} → ${fmt(e)}`;
export const nextId = (rows) =>
  rows.reduce((m, r) => {
    const n = parseInt(String(r.id).replace(/\D/g, ''), 10);
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0) + 1;

// ---- 派生状态 ----
export const openLoansOf = (loans, code) => loans.filter((l) => l.code === code && !l.returnedAt);
export const openRepairsOf = (repairs, code) =>
  repairs.filter((r) => r.code === code && r.status === '维修中');

export function deviceStatus(device, loans, repairs) {
  if (openRepairsOf(repairs, device.code).length) return '维修中';
  if (openLoansOf(loans, device.code).length) return '借出中';
  return '可借出';
}

export const loanStateText = (l) => {
  if (!l.returnedAt) return '借出中';
  if (l.damaged) return '损坏 · 已转修';
  return '已归还';
};

const overlap = (aS, aE, bS, bE) => aS < bE && aE > bS;

// ---- 借出 / 换绑校验：返回冲突列表（设备、展项、借出时段、触发规则）----
export function checkLend(devices, loans, repairs, exhibits, input) {
  const { code, exhibitId, start, end, receiver } = input;
  const device = devices.find((d) => d.code === code);
  const exhibit = exhibits.find((x) => x.id === exhibitId);
  const periodText = fmtPeriod(start, end);
  const base = { code: code || '—', exhibitTitle: exhibit ? exhibit.title : `#${exhibitId}`, periodText };
  const out = [];

  if (!device) {
    out.push({ ...base, rule: 'MISSING_DEVICE' });
    return out;
  }
  if (receiver !== undefined && !String(receiver).trim()) out.push({ ...base, rule: 'NO_RECEIVER' });
  if (!(start && end) || end <= start) out.push({ ...base, rule: 'BAD_TIME' });
  if (device.battery < 30) out.push({ ...base, rule: 'BATTERY', detail: `当前电量 ${device.battery}%` });
  if (openRepairsOf(repairs, code).length) out.push({ ...base, rule: 'REPAIR' });
  if (openLoansOf(loans, code).length) out.push({ ...base, rule: 'UNRETURNED' });
  if (!exhibit || exhibit.status !== '已发布') out.push({ ...base, rule: 'NOT_PUBLISHED' });

  // 同一时段只能绑定一个展项：与该机全部借还时段做重叠检测
  if (start && end && end > start) {
    const hit = loans.find(
      (l) => l.code === code && overlap(l.startAt, l.endAt, start, end),
    );
    if (hit) {
      out.push({
        ...base,
        rule: 'OVERLAP',
        detail: `与 ${hit.id}（${hit.exhibitTitle}，${fmtPeriod(hit.startAt, hit.endAt)}）时段重叠`,
      });
    }
  }
  return out;
}

// ---- 撤展校验：该展项是否仍占用设备 ----
export function checkUnpublish(exhibitId, loans) {
  return loans
    .filter((l) => l.exhibitId === exhibitId && !l.returnedAt)
    .map((l) => ({
      code: l.code,
      exhibitTitle: l.exhibitTitle,
      periodText: fmtPeriod(l.startAt, l.endAt),
      rule: 'UNPUBLISH',
      detail: `领取人 ${l.receiver}（${l.shift}），借还单 ${l.id}`,
    }));
}

// ---- 重新加载后的一致性审计：设备 / 展项 / 班次 / 维修必须互相对得上 ----
export function audit({ devices, loans, repairs, handovers, exhibits, shifts }) {
  const issues = [];
  const push = (rule, code, title, periodText, detail) =>
    issues.push({ rule, code: code || '—', exhibitTitle: title || '—', periodText: periodText || '—', detail });

  for (const l of loans) {
    const device = devices.find((d) => d.code === l.code);
    const exhibit = exhibits.find((x) => x.id === l.exhibitId);
    const periodText = fmtPeriod(l.startAt, l.endAt);

    if (!device) push('MISSING_DEVICE', l.code, l.exhibitTitle, periodText, `借还单 ${l.id}`);
    if (!exhibit) push('MISSING_EXHIBIT', l.code, l.exhibitTitle, periodText, `借还单 ${l.id}`);

    if (!l.returnedAt) {
      if (exhibit && exhibit.status !== '已发布') {
        push('BOUND_DRAFT', l.code, exhibit.title, periodText, `借还单 ${l.id} 应随撤展先释放`);
      }
      if (device && openRepairsOf(repairs, l.code).length) {
        push('LOAN_REPAIR', l.code, l.exhibitTitle, periodText, `借还单 ${l.id} 与维修单同时有效`);
      }
      if (device && openLoansOf(loans, l.code).length > 1) {
        push('DUP_OPEN', l.code, l.exhibitTitle, periodText, `借还单 ${l.id} 等多条记录未归还`);
      }
    }
    if (l.damaged && !(l.repairId && repairs.some((r) => r.id === l.repairId))) {
      push('BROKEN_CHAIN', l.code, l.exhibitTitle, periodText, `借还单 ${l.id} 标记损坏但找不到维修单`);
    }
  }

  // 时段重叠（跨记录）
  for (const code of new Set(loans.map((l) => l.code))) {
    const rows = loans.filter((l) => l.code === code);
    for (let i = 0; i < rows.length; i += 1) {
      for (let j = i + 1; j < rows.length; j += 1) {
        if (overlap(rows[i].startAt, rows[i].endAt, rows[j].startAt, rows[j].endAt)) {
          push(
            'INTERVAL_OVERLAP',
            code,
            rows[j].exhibitTitle,
            fmtPeriod(rows[j].startAt, rows[j].endAt),
            `${rows[i].id} 与 ${rows[j].id} 时段重叠`,
          );
        }
      }
    }
  }

  for (const r of repairs) {
    const loan = loans.find((l) => l.id === r.loanId);
    if (!loan) push('BROKEN_CHAIN', r.code, '—', '—', `维修单 ${r.id} 找不到原借还单 ${r.loanId}`);
  }

  for (const h of handovers) {
    const loan = loans.find((l) => l.id === h.loanId);
    if (!loan) {
      push('HANDOVER_LOST', h.code, '—', `${fmt(h.handedAt)} / 归还 ${fmt(h.returnAt)}`, `交接单 ${h.id}`);
    } else if (loan.code !== h.code) {
      push('HANDOVER_CODE', h.code, loan.exhibitTitle, `${fmt(h.handedAt)} / 归还 ${fmt(h.returnAt)}`,
        `交接单 ${h.id} 与借还单 ${loan.id} 设备编号不一致`);
    }
  }

  return issues;
}
