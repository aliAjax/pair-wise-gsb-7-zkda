import React, { useMemo, useState } from 'react';
import {
  LOW_BATTERY, fmt, shiftAt, shiftEndISO, toLocalInput, uid,
} from '../lib/domain.js';
import {
  checkLend, deviceStatus, activeLoanOf, openRepairOf, currentHolder, reconcile,
} from '../lib/rules.js';
import { ConflictBanner, Modal } from './Shared.jsx';

const STATUS_META = {
  idle: { label: '空闲', cls: 'ok' },
  out: { label: '借出中', cls: 'warn' },
  repair: { label: '维修中', cls: 'bad' },
};
const LOAN_META = {
  active: { label: '未归还', cls: 'warn' },
  returned: { label: '已归还', cls: 'ok' },
  damaged: { label: '损坏转修', cls: 'bad' },
};

export default function Ledger({ devices, exhibits, loans, repairs, shifts, patch, reset }) {
  const [tab, setTab] = useState('devices');
  const [devFilter, setDevFilter] = useState('全部');
  const [loanFilter, setLoanFilter] = useState('全部');
  const [notice, setNotice] = useState('');
  const [conflicts, setConflicts] = useState([]);
  const [lendSn, setLendSn] = useState(null);
  const [handoverId, setHandoverId] = useState(null);
  const [damageId, setDamageId] = useState(null);
  const [addOpen, setAddOpen] = useState(false);

  const now = new Date();
  const curShift = shiftAt(shifts, now);

  // 重新加载 / 数据变更后自检：设备、展项、班次、维修状态保持一致
  const issues = useMemo(
    () => reconcile({ devices, exhibits, loans, repairs }),
    [devices, exhibits, loans, repairs],
  );

  const titleOf = (id) => exhibits.find((e) => e.id === id)?.title || `展项#${id}`;
  const shiftName = (id) => shifts.find((s) => s.id === id)?.name || id;
  const statusOf = (sn) => deviceStatus(devices, loans, repairs, sn);

  const counts = {
    idle: devices.filter((d) => statusOf(d.sn) === 'idle').length,
    out: devices.filter((d) => statusOf(d.sn) === 'out').length,
    repair: devices.filter((d) => statusOf(d.sn) === 'repair').length,
    low: devices.filter((d) => d.battery < LOW_BATTERY).length,
  };

  const flash = (m) => { setNotice(m); setTimeout(() => setNotice(''), 2600); };

  // ---------- 台账动作 ----------
  const doLend = (payload) => {
    const hits = checkLend({ ...payload, devices, exhibits, loans, repairs });
    if (hits.length) { setConflicts(hits); return; }
    const loan = {
      id: uid('L'),
      sn: payload.sn,
      exhibitId: Number(payload.exhibitId),
      receiver: payload.receiver.trim(),
      shiftId: payload.shiftId,
      borrowAt: now.toISOString(),
      expectedReturnAt: new Date(payload.expectedReturnAt).toISOString(),
      returnAt: null,
      state: 'active',
      note: '',
      handovers: [],
      repairId: null,
    };
    patch((s) => ({ ...s, loans: [loan, ...s.loans] }));
    setLendSn(null); setConflicts([]);
    flash(`已借出：${payload.sn} 绑定「${titleOf(loan.exhibitId)}」，借据 ${loan.id}`);
  };

  // 正常归还：释放设备
  const doReturn = (loanId) => {
    patch((s) => ({
      ...s,
      loans: s.loans.map((l) =>
        l.id === loanId ? { ...l, returnAt: new Date().toISOString(), state: 'returned' } : l),
    }));
    flash('归还完成，设备已释放，可重新借出或换绑');
  };

  // 损坏归还：设备转入维修，保留原借还链（借据 -> 维修单）
  const doDamageReturn = (loanId, reason) => {
    const loan = loans.find((l) => l.id === loanId);
    if (!loan) return;
    const repairId = uid('RP');
    const ts = new Date().toISOString();
    patch((s) => ({
      ...s,
      loans: s.loans.map((l) =>
        l.id === loanId ? { ...l, returnAt: ts, state: 'damaged', repairId } : l),
      repairs: [{ id: repairId, sn: loan.sn, loanId, reason: reason.trim(), reportedAt: ts, resolvedAt: null }, ...s.repairs],
    }));
    setDamageId(null);
    flash(`已登记损坏：${loan.sn} 转入维修（维修单 ${repairId}），原借据 ${loanId} 已归档保留`);
  };

  // 跨班交接：记录领取人、设备编号与归还时间
  const doHandover = (loanId, p) => {
    const loan = loans.find((l) => l.id === loanId);
    const lastHolder = currentHolder(loan, shifts);
    const fromShiftId = loan.handovers?.length
      ? loan.handovers[loan.handovers.length - 1].toShiftId
      : loan.shiftId;
    const entry = {
      id: uid('H'),
      at: new Date().toISOString(),
      receiver: p.receiver.trim(),
      fromShiftId,
      toShiftId: p.toShiftId,
      expectedReturnAt: new Date(p.expectedReturnAt).toISOString(),
    };
    patch((s) => ({
      ...s,
      loans: s.loans.map((l) =>
        l.id === loanId
          ? { ...l, handovers: [...(l.handovers || []), entry], expectedReturnAt: entry.expectedReturnAt }
          : l),
    }));
    setHandoverId(null);
    flash(`跨班交接完成：${loan.sn} 由 ${lastHolder} 交接给 ${entry.receiver}（${shiftName(entry.toShiftId)}）`);
  };

  const resolveRepair = (rp) => {
    patch((s) => ({
      ...s,
      repairs: s.repairs.map((r) => (r.id === rp.id ? { ...r, resolvedAt: new Date().toISOString() } : r)),
      devices: s.devices.map((d) => (d.sn === rp.sn ? { ...d, battery: 100 } : d)),
    }));
    flash(`维修单 ${rp.id} 已闭环，${rp.sn} 满电恢复可借`);
  };

  const charge = (sn, v) => {
    patch((s) => ({
      ...s,
      devices: s.devices.map((d) => (d.sn === sn ? { ...d, battery: Math.max(0, Math.min(100, v)) } : d)),
    }));
  };

  const addDevice = (sn, model) => {
    if (!sn.trim() || devices.some((d) => d.sn === sn.trim())) {
      flash('设备编号为空或已存在'); return;
    }
    patch((s) => ({ ...s, devices: [...s.devices, { sn: sn.trim(), model: model.trim() || 'AG-200', battery: 100 }] }));
    setAddOpen(false);
    flash(`设备 ${sn.trim()} 已入库`);
  };

  const exportLedger = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ devices, exhibits, loans, repairs, shifts }, null, 2)], { type: 'application/json' }));
    a.download = 'guide-device-ledger.json';
    a.click();
    flash('已导出导览机借还台账');
  };

  // ---------- 派生视图数据 ----------
  const visibleDevices = devices.filter((d) => {
    if (devFilter === '全部') return true;
    if (devFilter === '低电量') return d.battery < LOW_BATTERY;
    return statusOf(d.sn) === { 空闲: 'idle', 借出中: 'out', 维修中: 'repair' }[devFilter];
  });
  const visibleLoans = [...loans]
    .sort((a, b) => new Date(b.borrowAt) - new Date(a.borrowAt))
    .filter((l) =>
      loanFilter === '全部' ? true
        : loanFilter === '未归还' ? l.state === 'active'
          : l.state === { 已归还: 'returned', 损坏转修: 'damaged' }[loanFilter]);
  const handovers = loans
    .flatMap((l) => (l.handovers || []).map((h) => ({ ...h, sn: l.sn, loanId: l.id })))
    .sort((a, b) => new Date(b.at) - new Date(a.at));

  return (
    <>
      <header className="topbar">
        <div>
          <span className="eyebrow">DEVICE LEDGER</span>
          <h1>导览机借还台账</h1>
        </div>
        <div className="top-actions">
          <button className="secondary" onClick={() => setAddOpen(true)}>＋ 设备入库</button>
          <button className="secondary" onClick={exportLedger}>↓ 导出台账</button>
          <button className="secondary danger" onClick={() => { if (confirm('重置为示例台账？当前记录将被清除。')) reset(); }}>↺ 重置示例</button>
        </div>
      </header>

      <div className="ledger-body">
        <div className="stat-row">
          <Stat label="设备总数" value={devices.length} />
          <Stat label="空闲可借" value={counts.idle} cls="ok" />
          <Stat label="借出中" value={counts.out} cls="warn" />
          <Stat label="维修中" value={counts.repair} cls="bad" />
          <Stat label={`电量 < ${LOW_BATTERY}%`} value={counts.low} cls={counts.low ? 'bad' : 'ok'} />
          <Stat label="当前班次" value={curShift ? curShift.name : '班外'} cls="muted" />
        </div>

        {issues.length > 0 && (
          <ConflictBanner conflicts={issues} title="重新加载后自检发现数据链异常" onClose={() => {}} />
        )}

        <div className="ledger-tabs">
          {[['devices', `设备状态 (${devices.length})`], ['loans', `借还记录 (${loans.length})`], ['shifts', `班次交接 (${handovers.length})`], ['repairs', `维修单 (${repairs.length})`]].map(
            ([k, label]) => <button key={k} className={tab === k ? 'selected' : ''} onClick={() => setTab(k)}>{label}</button>,
          )}
        </div>

        {tab === 'devices' && (
          <>
            <div className="filters">
              {['全部', '空闲', '借出中', '维修中', '低电量'].map((x) => (
                <button key={x} className={devFilter === x ? 'selected' : ''} onClick={() => setDevFilter(x)}>{x}</button>
              ))}
            </div>
            <div className="device-grid">
              {visibleDevices.map((d) => {
                const st = statusOf(d.sn);
                const active = activeLoanOf(loans, d.sn);
                const repair = openRepairOf(repairs, d.sn);
                return (
                  <article key={d.sn} className={'device-card ' + st}>
                    <div className="device-top">
                      <strong>{d.sn}</strong>
                      <span className={'chip ' + STATUS_META[st].cls}>{STATUS_META[st].label}</span>
                    </div>
                    <small className="device-model">{d.model}</small>
                    <Battery value={d.battery} />
                    <div className="device-bind">
                      {active && <p>绑定：<b>{titleOf(active.exhibitId)}</b><br /><small>持有人 {currentHolder(active, shifts)}</small></p>}
                      {repair && <p>维修单：<b>{repair.id}</b><br /><small>{repair.resolvedAt ? '已闭环' : '待修复'}</small></p>}
                      {!active && !repair && <p className="muted">未绑定展项</p>}
                    </div>
                    <div className="device-actions">
                      {st === 'idle' && <button className="primary sm" onClick={() => { setLendSn(d.sn); setConflicts([]); }}>借出 / 换绑</button>}
                      {active && <button className="secondary sm" onClick={() => doReturn(active.id)}>正常归还</button>}
                      {active && <button className="secondary sm danger-text" onClick={() => setDamageId(active.id)}>损坏归还</button>}
                      {active && <button className="secondary sm" onClick={() => setHandoverId(active.id)}>跨班交接</button>}
                      {st !== 'idle' || d.battery < 100 ? (
                        <button className="ghost-sm" onClick={() => charge(d.sn, d.battery < LOW_BATTERY ? 100 : Math.min(100, d.battery + 10))}>
                          ⚡ 充电{d.battery < LOW_BATTERY ? '至满' : '+10%'}
                        </button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        )}

        {tab === 'loans' && (
          <>
            <div className="filters">
              {['全部', '未归还', '已归还', '损坏转修'].map((x) => (
                <button key={x} className={loanFilter === x ? 'selected' : ''} onClick={() => setLoanFilter(x)}>{x}</button>
              ))}
            </div>
            <table className="ledger-table">
              <thead><tr><th>借据</th><th>设备编号</th><th>绑定展项</th><th>领取人</th><th>借出时间</th><th>约定归还</th><th>实际归还</th><th>状态 / 关联</th><th>操作</th></tr></thead>
              <tbody>
                {visibleLoans.map((l) => (
                  <tr key={l.id} className={l.state}>
                    <td className="mono">{l.id}</td>
                    <td className="mono">{l.sn}</td>
                    <td>{titleOf(l.exhibitId)}</td>
                    <td>{currentHolder(l, shifts)}</td>
                    <td className="mono">{fmt(l.borrowAt)}</td>
                    <td className="mono">{fmt(l.expectedReturnAt)}</td>
                    <td className="mono">{fmt(l.returnAt)}</td>
                    <td>
                      <span className={'chip ' + LOAN_META[l.state].cls}>{LOAN_META[l.state].label}</span>
                      {l.repairId && <small className="linked">维修单 {l.repairId}</small>}
                      {l.handovers?.length > 0 && <small className="linked">交接 ×{l.handovers.length}</small>}
                    </td>
                    <td className="row-actions">
                      {l.state === 'active' && <>
                        <button className="link-btn" onClick={() => doReturn(l.id)}>归还</button>
                        <button className="link-btn danger-text" onClick={() => setDamageId(l.id)}>损坏</button>
                        <button className="link-btn" onClick={() => setHandoverId(l.id)}>交接</button>
                      </>}
                      {l.state !== 'active' && <span className="muted">已归档</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {tab === 'shifts' && (
          <div className="shifts-wrap">
            <section>
              <h2>班次安排</h2>
              <div className="shift-cards">
                {shifts.map((s) => (
                  <div key={s.id} className={'shift-card' + (curShift?.id === s.id ? ' current' : '')}>
                    <strong>{s.name}</strong>
                    <span className="mono">{s.start} – {s.end}</span>
                    {curShift?.id === s.id && <span className="chip ok">进行中</span>}
                  </div>
                ))}
              </div>
              <p className="hint-line">借出时记录领取班次；跨班交接须登记新领取人、设备编号与约定归还时间。</p>
            </section>
            <section>
              <h2>交接记录</h2>
              {handovers.length === 0 && <p className="empty">暂无跨班交接记录</p>}
              <ul className="handover-list">
                {handovers.map((h) => (
                  <li key={h.id}>
                    <div><b className="mono">{h.sn}</b><span>借据 {h.loanId}</span></div>
                    <div><small>交接时间</small><b>{fmt(h.at)}</b></div>
                    <div><small>班次流转</small><b>{shiftName(h.fromShiftId)} → {shiftName(h.toShiftId)}</b></div>
                    <div><small>领取人</small><b>{h.receiver}</b></div>
                    <div><small>约定归还时间</small><b>{fmt(h.expectedReturnAt)}</b></div>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}

        {tab === 'repairs' && (
          <table className="ledger-table">
            <thead><tr><th>维修单</th><th>设备编号</th><th>来源借据（原借还链）</th><th>故障描述</th><th>报修时间</th><th>闭环时间</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>
              {[...repairs].sort((a, b) => new Date(b.reportedAt) - new Date(a.reportedAt)).map((r) => (
                <tr key={r.id} className={r.resolvedAt ? '' : 'open-repair'}>
                  <td className="mono">{r.id}</td>
                  <td className="mono">{r.sn}</td>
                  <td className="mono"><a className="link-btn" onClick={() => { setTab('loans'); setLoanFilter('损坏转修'); }}>{r.loanId}</a></td>
                  <td className="reason">{r.reason}</td>
                  <td className="mono">{fmt(r.reportedAt)}</td>
                  <td className="mono">{fmt(r.resolvedAt)}</td>
                  <td><span className={'chip ' + (r.resolvedAt ? 'ok' : 'bad')}>{r.resolvedAt ? '已闭环' : '维修中'}</span></td>
                  <td>{!r.resolvedAt && <button className="link-btn" onClick={() => resolveRepair(r)}>修复完成</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 借出 / 换绑弹窗 */}
      {lendSn && (
        <LendModal
          sn={lendSn}
          devices={devices}
          exhibits={exhibits}
          shifts={shifts}
          curShift={curShift}
          device={devices.find((d) => d.sn === lendSn)}
          conflicts={conflicts}
          onCancel={() => { setLendSn(null); setConflicts([]); }}
          onSubmit={doLend}
        />
      )}

      {/* 跨班交接弹窗 */}
      {handoverId && (
        <HandoverModal
          loan={loans.find((l) => l.id === handoverId)}
          shifts={shifts}
          curShift={curShift}
          titleOf={titleOf}
          onCancel={() => setHandoverId(null)}
          onSubmit={(p) => doHandover(handoverId, p)}
        />
      )}

      {/* 损坏归还弹窗 */}
      {damageId && (
        <DamageModal
          loan={loans.find((l) => l.id === damageId)}
          titleOf={titleOf}
          onCancel={() => setDamageId(null)}
          onSubmit={(reason) => doDamageReturn(damageId, reason)}
        />
      )}

      {/* 设备入库 */}
      {addOpen && <AddDeviceModal onCancel={() => setAddOpen(false)} onSubmit={addDevice} />}

      {notice && <div className="toast">{notice}</div>}
    </>
  );
}

function Stat({ label, value, cls = '' }) {
  return <div className={'stat ' + cls}><b>{value}</b><span>{label}</span></div>;
}

function Battery({ value }) {
  return (
    <div className={'battery ' + (value < LOW_BATTERY ? 'low' : '')}>
      <div className="battery-bar"><i style={{ width: `${value}%` }} /></div>
      <span>{value}%</span>
    </div>
  );
}

function LendModal({ sn, devices, exhibits, shifts, curShift, device, conflicts, onCancel, onSubmit }) {
  const published = exhibits.filter((e) => e.status === '已发布');
  const [exhibitId, setExhibitId] = useState(published[0]?.id ?? '');
  const [receiver, setReceiver] = useState('');
  const [shiftId, setShiftId] = useState(curShift?.id || shifts[0]?.id);
  const [expected, setExpected] = useState(() =>
    toLocalInput(shiftEndISO(curShift || shifts[0])));
  const shift = shifts.find((s) => s.id === shiftId);

  return (
    <Modal title={`借出 / 换绑 · ${sn}`} onClose={onCancel}>
      <div className="modal-body">
        <div className="modal-device">
          <span className={'chip ' + (device.battery < LOW_BATTERY ? 'bad' : 'ok')}>
            电量 {device.battery}%{device.battery < LOW_BATTERY ? `（低于 ${LOW_BATTERY}% 不可借）` : ''}
          </span>
          <span>{device.model}</span>
        </div>
        <label>绑定展项（仅限已发布）
          <select value={exhibitId} onChange={(e) => setExhibitId(e.target.value)}>
            {published.length === 0 && <option value="">暂无已发布展项</option>}
            {published.map((e) => <option key={e.id} value={e.id}>{e.title} · {e.room}</option>)}
          </select>
        </label>
        <div className="two">
          <label>领取人<input value={receiver} onChange={(e) => setReceiver(e.target.value)} placeholder="讲解员/工作人员姓名" /></label>
          <label>借出班次
            <select value={shiftId} onChange={(e) => {
              setShiftId(e.target.value);
              setExpected(toLocalInput(shiftEndISO(shifts.find((s) => s.id === e.target.value))));
            }}>
              {shifts.map((s) => <option key={s.id} value={s.id}>{s.name}（{s.start}–{s.end}）</option>)}
            </select>
          </label>
        </div>
        <label>约定归还时间
          <input type="datetime-local" value={expected} onChange={(e) => setExpected(e.target.value)} />
          <small className="hint">默认 {shift?.name} 下班时间，可手动调整</small>
        </label>
        {conflicts.length > 0 && <ConflictBanner conflicts={conflicts} title="借出被规则拦截" />}
        <div className="modal-actions">
          <button className="secondary" onClick={onCancel}>取消</button>
          <button className="primary" disabled={!receiver.trim() || !exhibitId}
            onClick={() => onSubmit({ sn, exhibitId, receiver, shiftId, expectedReturnAt: expected })}>
            确认借出
          </button>
        </div>
      </div>
    </Modal>
  );
}

function HandoverModal({ loan, shifts, curShift, titleOf, onCancel, onSubmit }) {
  const [receiver, setReceiver] = useState('');
  const nextShift = shifts.find((s) => s.id !== loan.shiftId && curShift?.id !== s.id) || shifts[0];
  const [toShiftId, setToShiftId] = useState(curShift?.id || nextShift.id);
  const [expected, setExpected] = useState(toLocalInput(shiftEndISO(curShift || shifts[0])));
  return (
    <Modal title={`跨班交接 · ${loan.sn}`} onClose={onCancel}>
      <div className="modal-body">
        <p className="handover-context">
          设备 <b className="mono">{loan.sn}</b> 当前绑定「{titleOf(loan.exhibitId)}」，借据 <span className="mono">{loan.id}</span>
        </p>
        <label>接班领取人<input value={receiver} onChange={(e) => setReceiver(e.target.value)} placeholder="接班人姓名" /></label>
        <div className="two">
          <label>接班班次
            <select value={toShiftId} onChange={(e) => {
              setToShiftId(e.target.value);
              setExpected(toLocalInput(shiftEndISO(shifts.find((s) => s.id === e.target.value))));
            }}>
              {shifts.map((s) => <option key={s.id} value={s.id}>{s.name}（{s.start}–{s.end}）</option>)}
            </select>
          </label>
          <label>约定归还时间
            <input type="datetime-local" value={expected} onChange={(e) => setExpected(e.target.value)} />
          </label>
        </div>
        <div className="modal-actions">
          <button className="secondary" onClick={onCancel}>取消</button>
          <button className="primary" disabled={!receiver.trim()}
            onClick={() => onSubmit({ receiver, toShiftId, expectedReturnAt: expected })}>
            完成交接
          </button>
        </div>
      </div>
    </Modal>
  );
}

function DamageModal({ loan, titleOf, onCancel, onSubmit }) {
  const [reason, setReason] = useState('');
  return (
    <Modal title={`损坏归还 · ${loan.sn}`} onClose={onCancel}>
      <div className="modal-body">
        <p className="handover-context">
          借据 <span className="mono">{loan.id}</span>（绑定「{titleOf(loan.exhibitId)}」）将标记为损坏归还，
          设备立即转入维修，<b>原借还链保留并自动关联新维修单</b>。
        </p>
        <label>故障现象 / 备注
          <textarea rows="4" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="如：无法开机、屏幕碎裂、按键失灵……" />
        </label>
        <div className="modal-actions">
          <button className="secondary" onClick={onCancel}>取消</button>
          <button className="primary danger-bg" disabled={!reason.trim()} onClick={() => onSubmit(reason)}>确认损坏并转修</button>
        </div>
      </div>
    </Modal>
  );
}

function AddDeviceModal({ onCancel, onSubmit }) {
  const [sn, setSn] = useState('');
  const [model, setModel] = useState('AG-200');
  return (
    <Modal title="导览机入库" onClose={onCancel}>
      <div className="modal-body">
        <div className="two">
          <label>设备编号<input value={sn} onChange={(e) => setSn(e.target.value)} placeholder="如 G-006" /></label>
          <label>型号<input value={model} onChange={(e) => setModel(e.target.value)} /></label>
        </div>
        <small className="hint">新设备默认满电、空闲可借</small>
        <div className="modal-actions">
          <button className="secondary" onClick={onCancel}>取消</button>
          <button className="primary" disabled={!sn.trim()} onClick={() => onSubmit(sn, model)}>入库</button>
        </div>
      </div>
    </Modal>
  );
}
