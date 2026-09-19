// 台账规则引擎（纯函数，便于复用与自检）
// 冲突统一结构 { rule, device, exhibit, period, message }
import { LOW_BATTERY, fmt } from './domain.js';

export const activeLoanOf = (loans, sn) =>
  loans.find((l) => l.sn === sn && !l.returnAt) || null;

export const openRepairOf = (repairs, sn) =>
  repairs.find((r) => r.sn === sn && !r.resolvedAt) || null;

// 设备实时状态由借据与维修单派生：维修中 / 借出中 / 空闲
export function deviceStatus(devices, loans, repairs, sn) {
  if (openRepairOf(repairs, sn)) return 'repair';
  if (activeLoanOf(loans, sn)) return 'out';
  return 'idle';
}

export const currentHolder = (loan, shifts) => {
  const shiftName = (id) => shifts.find((s) => s.id === id)?.name || id;
  const h = loan.handovers?.[loan.handovers.length - 1];
  return h
    ? `${h.receiver}（${shiftName(h.toShiftId)}）`
    : `${loan.receiver}（${shiftName(loan.shiftId)}）`;
};

const loanPeriod = (loan) =>
  `借出 ${fmt(loan.borrowAt)} → 约定归还 ${fmt(loan.expectedReturnAt)}`;

/**
 * 借出前校验。返回冲突数组（空数组表示可借出）。
 * R1 展项必须已发布
 * R2 设备不能存在未闭环维修单
 * R3 同一设备同一时段只能绑定一个已发布展项（存在未归还记录即冲突）
 * R4 电量低于 30% 不得借出
 */
export function checkLend({ sn, exhibitId, devices, exhibits, loans, repairs }) {
  const conflicts = [];
  const device = devices.find((d) => d.sn === sn);
  const exhibit = exhibits.find((e) => e.id === exhibitId);

  // R2 维修中（最优先：维修中的设备不应参与任何台账操作）
  const repair = openRepairOf(repairs, sn);
  if (repair) {
    conflicts.push({
      rule: 'R2',
      device: sn,
      exhibit: exhibit?.title || '—',
      period: `维修单 ${repair.id} 于 ${fmt(repair.reportedAt)} 发起，尚未闭环`,
      message: `设备 ${sn} 正在维修（维修单 ${repair.id}），维修闭环前不得借出`,
    });
  }

  // R3 未归还记录 = 同一时段重复绑定
  const active = activeLoanOf(loans, sn);
  if (active) {
    const bound = exhibits.find((e) => e.id === active.exhibitId);
    conflicts.push({
      rule: 'R3',
      device: sn,
      exhibit: bound?.title || `展项#${active.exhibitId}`,
      period: loanPeriod(active),
      message: `设备 ${sn} 当前已绑定展项「${bound?.title || active.exhibitId}」且存在未归还记录（借据 ${active.id}），须先归还/释放才能换绑`,
    });
  }

  // R4 电量
  if (device && device.battery < LOW_BATTERY) {
    conflicts.push({
      rule: 'R4',
      device: sn,
      exhibit: exhibit?.title || '—',
      period: '—',
      message: `设备 ${sn} 当前电量 ${device.battery}%，低于 ${LOW_BATTERY}%，充电后才能借出`,
    });
  }

  // R1 展项已发布
  if (!exhibit || exhibit.status !== '已发布') {
    conflicts.push({
      rule: 'R1',
      device: sn,
      exhibit: exhibit?.title || '—',
      period: '—',
      message: `展项「${exhibit?.title || exhibitId}」未发布，只有已发布展项才能绑定导览机借出`,
    });
  }

  return conflicts;
}

/**
 * 撤展（已发布 → 草稿）前校验 R5。
 * 撤展或换绑先释放设备：仍有设备绑着该展项在借时，必须先归还释放。
 */
export function checkUnpublish({ exhibitId, loans, exhibits }) {
  const exhibit = exhibits.find((e) => e.id === exhibitId);
  return loans
    .filter((l) => l.exhibitId === exhibitId && !l.returnAt)
    .map((l) => ({
      rule: 'R5',
      device: l.sn,
      exhibit: exhibit?.title || `展项#${exhibitId}`,
      period: loanPeriod(l),
      message: `撤展前须先释放设备：${l.sn} 仍绑定「${exhibit?.title}」在借（借据 ${l.id}，领用人 ${l.receiver}），请先办理归还`,
    }));
}

/**
 * 换绑（给设备选择另一个已发布展项）= 对新绑定做一次完整借出校验，
 * 设备必须处于空闲态，R3 会拦下未释放设备。
 */
export const checkRebind = (args) => checkLend(args);

/** 台账自检：重新加载后校验损坏借据的维修链是否完整 */
export function reconcile({ exhibits, loans, repairs }) {
  return loans
    .filter((x) => x.state === 'damaged')
    .filter((l) => {
      const rp = repairs.find((r) => r.id === l.repairId);
      return !rp || rp.sn !== l.sn;
    })
    .map((l) => ({
      rule: 'R6',
      device: l.sn,
      exhibit: exhibits.find((e) => e.id === l.exhibitId)?.title || '—',
      period: loanPeriod(l),
      message: `借据 ${l.id} 标记损坏但维修链缺失（${l.sn}），原借还链须保留并补录维修单`,
    }));
}
