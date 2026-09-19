import React, { useEffect, useMemo, useState } from 'react';
import {
  loadDevices, loadLoans, loadHandovers, loadRepairs, loadShifts,
  checkLend, checkUnpublish, audit, deviceStatus, loanStateText,
  nowInput, plusHours, fmt, fmtPeriod, nextId, RULES,
} from './model';

const pad4 = (n) => String(n).padStart(4, '0');

function ConflictTable({ rows, empty }) {
  if (!rows.length) return <div className="lg-ok">✓ {empty}</div>;
  return (
    <table className="lg-table">
      <thead><tr><th>设备</th><th>展项</th><th>借出时段</th><th>触发规则</th><th>说明</th></tr></thead>
      <tbody>
        {rows.map((c, i) => (
          <tr key={i}>
            <td className="mono">{c.code}</td>
            <td>{c.exhibitTitle}</td>
            <td className="mono small">{c.periodText}</td>
            <td><span className="lg-rule">{RULES[c.rule] || c.rule}</span></td>
            <td className="small dim">{c.detail || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function Ledger({ exhibits, onUnpublishExhibit }) {
  const [devices, setDevices] = useState(loadDevices);
  const [loans, setLoans] = useState(loadLoans);
  const [handovers, setHandovers] = useState(loadHandovers);
  const [repairs, setRepairs] = useState(loadRepairs);
  const [shifts, setShifts] = useState(loadShifts);

  const [tab, setTab] = useState('lend');
  const [toast, setToast] = useState('');
  const [attempt, setAttempt] = useState([]); // 最近一次被拦截的借出尝试
  const [modal, setModal] = useState(null);  // {type, loan}
  const [modalErr, setModalErr] = useState([]);

  const t0 = nowInput();
  const [form, setForm] = useState({ code: 'DG-001', exhibitId: 1, receiver: '', shift: '早班', start: t0, end: plusHours(t0, 4) });
  const [retForm, setRetForm] = useState({ at: t0, damaged: false, reason: '', battery: 100 });
  const [rbForm, setRbForm] = useState({ exhibitId: 1, end: plusHours(t0, 4) });
  const [hoForm, setHoForm] = useState({ receiver: '', toShift: '中班', returnAt: plusHours(t0, 4) });
  const [newDevice, setNewDevice] = useState({ code: '', model: 'AG-Pro', battery: 100 });
  const [newShift, setNewShift] = useState('');

  const persist = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  useEffect(() => persist('guide-devices', devices), [devices]);
  useEffect(() => persist('guide-loans', loans), [loans]);
  useEffect(() => persist('guide-handovers', handovers), [handovers]);
  useEffect(() => persist('guide-repairs', repairs), [repairs]);
  useEffect(() => persist('guide-shifts', shifts), [shifts]);

  const say = (m) => { setToast(m); };

  // ---- 重新加载：重读持久层并跑一致性审计 ----
  const reload = () => {
    const d = loadDevices(); const l = loadLoans(); const h = loadHandovers();
    const r = loadRepairs(); const s = loadShifts();
    setDevices(d); setLoans(l); setHandovers(h); setRepairs(r); setShifts(s);
    const n = audit({ devices: d, loans: l, repairs: r, handovers: h, exhibits, shifts: s }).length;
    setAttempt([]);
    say(n ? `重新加载完成：发现 ${n} 条不一致，见下方冲突清单` : '重新加载完成：设备、展项、班次与维修状态一致');
  };

  const issues = useMemo(
    () => audit({ devices, loans, repairs, handovers, exhibits, shifts }),
    [devices, loans, repairs, handovers, exhibits, shifts],
  );
  const openLoans = useMemo(() => loans.filter((l) => !l.returnedAt), [loans]);
  const nextMap = useMemo(() => {
    const m = {};
    loans.forEach((l) => { if (l.prevId) m[l.prevId] = l.id; });
    return m;
  }, [loans]);
  const chainOf = (l) => `${l.prevId || '∅'} → ${l.id}${nextMap[l.id] ? ` → ${nextMap[l.id]}` : ''}`;

  const stats = [
    ['设备总数', devices.length],
    ['可借出', devices.filter((d) => deviceStatus(d, loans, repairs) === '可借出').length],
    ['借出中', openLoans.length],
    ['维修中', repairs.filter((r) => r.status === '维修中').length],
    ['冲突 / 异常', issues.length],
  ];

  // ---- 借出 ----
  const doLend = () => {
    const conflicts = checkLend(devices, loans, repairs, exhibits, {
      code: form.code, exhibitId: Number(form.exhibitId),
      start: form.start, end: form.end, receiver: form.receiver,
    });
    if (conflicts.length) { setAttempt(conflicts); say('借出被规则拦截'); return; }
    const exhibit = exhibits.find((x) => x.id === Number(form.exhibitId));
    const loan = {
      id: `L${pad4(nextId(loans))}`, code: form.code, exhibitId: exhibit.id, exhibitTitle: exhibit.title,
      receiver: form.receiver.trim(), shift: form.shift, startAt: form.start, endAt: form.end,
      returnedAt: null, returnType: null, damaged: false, repairId: null, handovers: [], prevId: null,
    };
    setLoans([...loans, loan]);
    setAttempt([]);
    setForm({ ...form, receiver: '' });
    say(`借出登记成功：${loan.code} → ${exhibit.title}（借还单 ${loan.id}）`);
  };

  // ---- 归还（损坏必须转入维修，并保留原借还链）----
  const openReturn = (l) => {
    const d = devices.find((x) => x.code === l.code);
    setRetForm({ at: nowInput(), damaged: false, reason: '', battery: d ? d.battery : 100 });
    setModalErr([]);
    setModal({ type: 'return', loan: l });
  };
  const doReturn = () => {
    const l = modal.loan;
    if (!(retForm.at && retForm.at > l.startAt)) { setModalErr([{ rule: 'BAD_TIME' }]); return; }
    let repair = null;
    if (retForm.damaged) {
      repair = {
        id: `R${pad4(nextId(repairs))}`, code: l.code, loanId: l.id,
        reason: retForm.reason.trim() || '归还时发现损坏', at: retForm.at,
        status: '维修中', fixedAt: null,
      };
      setRepairs([...repairs, repair]);
    }
    setLoans(loans.map((x) => (x.id === l.id ? {
      ...x, returnedAt: retForm.at, battery: retForm.battery,
      returnType: repair ? '损坏转修' : '正常归还',
      damaged: !!repair, repairId: repair ? repair.id : x.repairId,
    } : x)));
    setDevices(devices.map((d) => (d.code === l.code ? { ...d, battery: Number(retForm.battery) } : d)));
    setModal(null);
    say(repair ? `已归还并转入维修：维修单 ${repair.id}，借还链 ${l.id} 已保留` : '归还登记成功，设备已释放');
  };

  // ---- 跨班交接：记录领取人、设备编号与归还时间 ----
  const openHandover = (l) => {
    setHoForm({ receiver: '', toShift: shifts[0]?.name || '', returnAt: l.endAt });
    setModalErr([]);
    setModal({ type: 'handover', loan: l });
  };
  const doHandover = () => {
    const l = modal.loan;
    if (!hoForm.receiver.trim()) { setModalErr([{ rule: 'NO_RECEIVER' }]); return; }
    if (!hoForm.returnAt) { setModalErr([{ rule: 'BAD_TIME' }]); return; }
    const h = {
      id: `H${pad4(nextId(handovers))}`, loanId: l.id, code: l.code,
      fromReceiver: l.receiver, fromShift: l.shift,
      receiver: hoForm.receiver.trim(), toShift: hoForm.toShift,
      handedAt: nowInput(), returnAt: hoForm.returnAt,
    };
    setHandovers([...handovers, h]);
    setLoans(loans.map((x) => (x.id === l.id
      ? { ...x, receiver: h.receiver, shift: h.toShift, handovers: [...x.handovers, h.id] } : x)));
    setModal(null);
    say(`跨班交接已登记：${h.fromReceiver} → ${h.receiver}（${h.code}，预计归还 ${fmt(h.returnAt)}）`);
  };

  // ---- 换绑：先释放设备，再绑定新展项（新借还单接续原链）----
  const openRebind = (l) => {
    setRbForm({ exhibitId: l.exhibitId, end: plusHours(nowInput(), 4) });
    setModalErr([]);
    setModal({ type: 'rebind', loan: l });
  };
  const doRebind = () => {
    const old = modal.loan;
    const at = nowInput();
    const released = loans.map((x) => (x.id === old.id
      ? { ...x, returnedAt: at, returnType: '换绑释放' } : x));
    const conflicts = checkLend(devices, released, repairs, exhibits, {
      code: old.code, exhibitId: Number(rbForm.exhibitId), start: at, end: rbForm.end, receiver: old.receiver,
    });
    if (conflicts.length) { setModalErr(conflicts); setAttempt(conflicts); return; }
    const exhibit = exhibits.find((x) => x.id === Number(rbForm.exhibitId));
    const loan = {
      id: `L${pad4(nextId(loans))}`, code: old.code, exhibitId: exhibit.id, exhibitTitle: exhibit.title,
      receiver: old.receiver, shift: old.shift, startAt: at, endAt: rbForm.end,
      returnedAt: null, returnType: null, damaged: false, repairId: null, handovers: [], prevId: old.id,
    };
    setLoans([...released, loan]);
    setModal(null);
    say(`换绑成功：${old.code} 已释放（${old.id}），现绑定「${exhibit.title}」（${loan.id}）`);
  };

  // ---- 撤展 / 手动释放 ----
  const doRelease = (l) => {
    setLoans(loans.map((x) => (x.id === l.id
      ? { ...x, returnedAt: nowInput(), returnType: '撤展释放' } : x)));
    say(`设备 ${l.code} 已释放（借还单 ${l.id}）`);
  };
  const releaseExhibit = (id) => {
    const at = nowInput();
    const hit = loans.filter((l) => l.exhibitId === id && !l.returnedAt);
    setLoans(loans.map((l) => (l.exhibitId === id && !l.returnedAt
      ? { ...l, returnedAt: at, returnType: '撤展释放' } : l)));
    onUnpublishExhibit(id);
    say(`撤展完成：已释放 ${hit.length} 台设备（${hit.map((l) => l.code).join('、') || '无占用'}），展项转为草稿`);
  };

  // ---- 维修 / 设备 / 班次 ----
  const completeRepair = (r) => {
    setRepairs(repairs.map((x) => (x.id === r.id ? { ...x, status: '已修复', fixedAt: nowInput() } : x)));
    say(`维修单 ${r.id} 已完成，${r.code} 恢复可借出`);
  };
  const addDevice = () => {
    const code = newDevice.code.trim().toUpperCase();
    if (!code) return;
    if (devices.some((d) => d.code === code)) { setAttempt([{ code, exhibitTitle: '—', periodText: '—', rule: 'DEVICE_EXISTS' }]); return; }
    setDevices([...devices, { code, model: newDevice.model, battery: Number(newDevice.battery) }]);
    setNewDevice({ code: '', model: 'AG-Pro', battery: 100 });
    say(`设备 ${code} 已入库`);
  };
  const addShift = () => {
    const name = newShift.trim();
    if (!name || shifts.some((s) => s.name === name)) return;
    setShifts([...shifts, { name, hours: '' }]);
    setNewShift('');
  };

  const tabs = [
    ['lend', `借出 / 归还${openLoans.length ? ` (${openLoans.length})` : ''}`],
    ['records', `借还台账 (${loans.length})`],
    ['handovers', `跨班交接 (${handovers.length})`],
    ['devices', `设备 (${devices.length})`],
    ['repairs', `维修 (${repairs.filter((r) => r.status === '维修中').length})`],
    ['exhibits', '展项 / 撤展'],
  ];

  return (
    <div className="ledger">
      <header className="topbar">
        <div><span className="eyebrow">DEVICE LEDGER</span><h1>导览机借还台账</h1></div>
        <div className="top-actions">
          <button className="secondary" onClick={reload}>↻ 重新加载并校验</button>
        </div>
      </header>

      <div className="lg-body">
        <div className="lg-stats">
          {stats.map(([k, v]) => (
            <div className="lg-stat" key={k}><b>{v}</b><span>{k}</span></div>
          ))}
        </div>

        <section className="lg-card lg-conflict">
          <div className="lg-card-h"><h2>冲突与一致性{issues.length > 0 && <em className="lg-badge">{issues.length}</em>}</h2>
            <small>重新加载后自动审计设备 / 展项 / 班次 / 维修状态</small></div>
          <ConflictTable rows={issues} empty="设备、展项、班次与维修状态一致，无冲突" />
        </section>

        <div className="lg-tabs">
          {tabs.map(([k, label]) => (
            <button key={k} className={tab === k ? 'selected' : ''} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>

        {/* ---------- 借出 / 归还 ---------- */}
        {tab === 'lend' && (
          <div className="lg-grid2">
            <section className="lg-card">
              <div className="lg-card-h"><h2>借出登记</h2><small>同一时段一台机只能绑定一个已发布展项</small></div>
              {attempt.length > 0 && (
                <div className="lg-alert">
                  <strong>该借出被 {attempt.length} 条规则拦截：</strong>
                  <ConflictTable rows={attempt} empty="" />
                </div>
              )}
              <div className="lg-form">
                <label>展项
                  <select value={form.exhibitId} onChange={(e) => setForm({ ...form, exhibitId: Number(e.target.value) })}>
                    {exhibits.map((x) => <option key={x.id} value={x.id}>{x.title}{x.status !== '已发布' ? `（${x.status}）` : ''}</option>)}
                  </select>
                </label>
                <label>导览机
                  <select value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })}>
                    {devices.map((d) => {
                      const st = deviceStatus(d, loans, repairs);
                      return <option key={d.code} value={d.code}>{d.code} · {d.model} · {d.battery}% · {st}</option>;
                    })}
                  </select>
                </label>
                <label>领取人<input value={form.receiver} placeholder="借出必须登记领取人" onChange={(e) => setForm({ ...form, receiver: e.target.value })} /></label>
                <label>班次
                  <select value={form.shift} onChange={(e) => setForm({ ...form, shift: e.target.value })}>
                    {shifts.map((s) => <option key={s.name} value={s.name}>{s.name}{s.hours ? ` ${s.hours}` : ''}</option>)}
                  </select>
                </label>
                <label>借出时间<input type="datetime-local" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></label>
                <label>应归还时间<input type="datetime-local" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} /></label>
                <button className="primary full" onClick={doLend}>登记借出 ↗</button>
                <p className="lg-ruleline">校验：电量 ≥ 30% · 无未归还记录 · 非维修中 · 展项已发布 · 时段不重叠</p>
              </div>
            </section>

            <section className="lg-card">
              <div className="lg-card-h"><h2>未归还（{openLoans.length}）</h2><small>归还 / 换绑 / 交接均从这里发起</small></div>
              <table className="lg-table">
                <thead><tr><th>设备</th><th>展项 / 领取人</th><th>借出时段</th><th>操作</th></tr></thead>
                <tbody>
                  {openLoans.map((l) => (
                    <tr key={l.id}>
                      <td className="mono">{l.code}<br /><small className="dim">{l.id} · {l.shift}</small></td>
                      <td><strong>{l.exhibitTitle}</strong><br /><small className="dim">领取：{l.receiver}{l.handovers.length ? ` · 交接×${l.handovers.length}` : ''}</small></td>
                      <td className="mono small">{fmtPeriod(l.startAt, l.endAt)}</td>
                      <td className="lg-ops">
                        <button className="secondary" onClick={() => openReturn(l)}>归还</button>
                        <button className="secondary" onClick={() => openHandover(l)}>跨班交接</button>
                        <button className="secondary" onClick={() => openRebind(l)}>换绑</button>
                        <button className="lg-danger" onClick={() => doRelease(l)}>释放</button>
                      </td>
                    </tr>
                  ))}
                  {!openLoans.length && <tr><td colSpan={4} className="dim lg-empty">当前没有借出中的设备</td></tr>}
                </tbody>
              </table>
            </section>
          </div>
        )}

        {/* ---------- 借还台账 ---------- */}
        {tab === 'records' && (
          <section className="lg-card">
            <div className="lg-card-h"><h2>全部借还记录</h2><small>损坏归还保留原借还链；换绑以 prevId 接续</small></div>
            <table className="lg-table">
              <thead><tr><th>借还单</th><th>设备</th><th>展项</th><th>领取人/班次</th><th>借出 → 归还</th><th>结果</th><th>借还链 / 交接</th></tr></thead>
              <tbody>
                {[...loans].reverse().map((l) => (
                  <tr key={l.id}>
                    <td className="mono">{l.id}</td>
                    <td className="mono">{l.code}</td>
                    <td>{l.exhibitTitle}</td>
                    <td>{l.receiver}<br /><small className="dim">{l.shift}</small></td>
                    <td className="mono small">{fmt(l.startAt)} → {fmt(l.returnedAt)}{l.returnType ? <><br /><small className="dim">{l.returnType}</small></> : ''}</td>
                    <td><span className={`lg-pill ${l.damaged ? 'bad' : l.returnedAt ? 'ok' : 'out'}`}>{loanStateText(l)}</span></td>
                    <td className="mono small">{chainOf(l)}{l.handovers.length ? <><br /><small className="dim">交接单 {l.handovers.join('、')}</small></> : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {/* ---------- 跨班交接 ---------- */}
        {tab === 'handovers' && (
          <div className="lg-grid2">
            <section className="lg-card">
              <div className="lg-card-h"><h2>交接记录（{handovers.length}）</h2><small>领取人 · 设备编号 · 归还时间</small></div>
              <table className="lg-table">
                <thead><tr><th>交接单</th><th>设备</th><th>交出 → 领取</th><th>交接时间</th><th>预计归还</th><th>借还单</th></tr></thead>
                <tbody>
                  {[...handovers].reverse().map((h) => (
                    <tr key={h.id}>
                      <td className="mono">{h.id}</td>
                      <td className="mono">{h.code}</td>
                      <td>{h.fromReceiver}（{h.fromShift}）<br />→ <strong>{h.receiver}</strong>（{h.toShift}）</td>
                      <td className="mono small">{fmt(h.handedAt)}</td>
                      <td className="mono small">{fmt(h.returnAt)}</td>
                      <td className="mono">{h.loanId}</td>
                    </tr>
                  ))}
                  {!handovers.length && <tr><td colSpan={6} className="dim lg-empty">暂无交接记录</td></tr>}
                </tbody>
              </table>
            </section>
            <section className="lg-card">
              <div className="lg-card-h"><h2>班次设置</h2><small>借出与交接时引用</small></div>
              <ul className="lg-shifts">
                {shifts.map((s) => <li key={s.name}><b>{s.name}</b><span className="dim">{s.hours || '未排时段'}</span></li>)}
              </ul>
              <div className="lg-inline">
                <input placeholder="新增班次，如 夜班" value={newShift} onChange={(e) => setNewShift(e.target.value)} />
                <button className="primary" onClick={addShift}>添加</button>
              </div>
            </section>
          </div>
        )}

        {/* ---------- 设备 ---------- */}
        {tab === 'devices' && (
          <section className="lg-card">
            <div className="lg-card-h"><h2>设备清单（{devices.length}）</h2><small>电量低于 30% 自动不可借出</small></div>
            <table className="lg-table">
              <thead><tr><th>设备编号</th><th>型号</th><th>电量</th><th>状态</th><th>当前绑定</th></tr></thead>
              <tbody>
                {devices.map((d) => {
                  const st = deviceStatus(d, loans, repairs);
                  const bound = openLoans.find((l) => l.code === d.code);
                  return (
                    <tr key={d.code}>
                      <td className="mono">{d.code}</td>
                      <td>{d.model}</td>
                      <td className="lg-batt">
                        <input type="range" min="0" max="100" value={d.battery}
                          onChange={(e) => setDevices(devices.map((x) => x.code === d.code ? { ...x, battery: Number(e.target.value) } : x))} />
                        <span className={d.battery < 30 ? 'lg-red mono' : 'mono'}>{d.battery}%</span>
                      </td>
                      <td><span className={`lg-pill ${st === '维修中' ? 'bad' : st === '借出中' ? 'out' : 'ok'}`}>{st}</span></td>
                      <td>{bound ? `${bound.exhibitTitle}（${bound.receiver}，至 ${fmt(bound.endAt)}）` : <span className="dim">空闲</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="lg-inline lg-addline">
              <input placeholder="设备编号 DG-006" value={newDevice.code} onChange={(e) => setNewDevice({ ...newDevice, code: e.target.value })} />
              <select value={newDevice.model} onChange={(e) => setNewDevice({ ...newDevice, model: e.target.value })}>
                <option>AG-Pro</option><option>AG-Lite</option>
              </select>
              <input type="number" min="0" max="100" value={newDevice.battery} onChange={(e) => setNewDevice({ ...newDevice, battery: e.target.value })} />
              <button className="primary" onClick={addDevice}>设备入库</button>
            </div>
          </section>
        )}

        {/* ---------- 维修 ---------- */}
        {tab === 'repairs' && (
          <section className="lg-card">
            <div className="lg-card-h"><h2>维修单</h2><small>归还损坏自动转入，保留原借还链</small></div>
            <table className="lg-table">
              <thead><tr><th>维修单</th><th>设备</th><th>原因</th><th>来源借还单</th><th>送修/完成</th><th>状态</th><th></th></tr></thead>
              <tbody>
                {[...repairs].reverse().map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{r.id}</td>
                    <td className="mono">{r.code}</td>
                    <td>{r.reason}</td>
                    <td className="mono">{r.loanId}</td>
                    <td className="mono small">{fmt(r.at)}<br />{fmt(r.fixedAt)}</td>
                    <td><span className={`lg-pill ${r.status === '维修中' ? 'bad' : 'ok'}`}>{r.status}</span></td>
                    <td>{r.status === '维修中' && <button className="secondary" onClick={() => completeRepair(r)}>完成维修</button>}</td>
                  </tr>
                ))}
                {!repairs.length && <tr><td colSpan={7} className="dim lg-empty">暂无维修单</td></tr>}
              </tbody>
            </table>
          </section>
        )}

        {/* ---------- 展项 / 撤展 ---------- */}
        {tab === 'exhibits' && (
          <section className="lg-card">
            <div className="lg-card-h"><h2>展项占用与撤展</h2><small>撤展或换绑前先释放设备</small></div>
            <table className="lg-table">
              <thead><tr><th>展项</th><th>展厅</th><th>状态</th><th>占用中的设备</th><th>操作</th></tr></thead>
              <tbody>
                {exhibits.map((x) => {
                  const bound = loans.filter((l) => l.exhibitId === x.id && !l.returnedAt);
                  return (
                    <tr key={x.id}>
                      <td><strong>{x.title}</strong></td>
                      <td className="small">{x.room}</td>
                      <td><span className={`status ${x.status === '已发布' ? 'live' : 'draft'}`}>{x.status}</span></td>
                      <td className="small">{bound.length
                        ? bound.map((l) => <span key={l.id} className="lg-chip">{l.code} · {l.receiver} · 至 {fmt(l.endAt)}</span>)
                        : <span className="dim">无</span>}</td>
                      <td>{x.status === '已发布'
                        ? <button className={bound.length ? 'lg-danger' : 'secondary'} onClick={() => releaseExhibit(x.id)}>
                            {bound.length ? `撤展：先释放 ${bound.length} 台` : '撤回发布'}
                          </button>
                        : <span className="dim">草稿不可绑定设备</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}
      </div>

      {/* ---------- 弹窗：归还 / 交接 / 换绑 ---------- */}
      {modal && (
        <div className="lg-mask" onClick={() => setModal(null)}>
          <div className="lg-modal" onClick={(e) => e.stopPropagation()}>
            {modal.type === 'return' && (
              <>
                <h3>归还登记 · {modal.loan.code} <small className="dim mono">{modal.loan.id}</small></h3>
                <p className="dim small">原借出：{modal.loan.exhibitTitle} · {modal.loan.receiver} · {fmtPeriod(modal.loan.startAt, modal.loan.endAt)}</p>
                {modalErr.length > 0 && <div className="lg-alert"><ConflictTable rows={modalErr} empty="" /></div>}
                <label>归还时间<input type="datetime-local" value={retForm.at} onChange={(e) => setRetForm({ ...retForm, at: e.target.value })} /></label>
                <label>归还电量（%）<input type="number" min="0" max="100" value={retForm.battery} onChange={(e) => setRetForm({ ...retForm, battery: e.target.value })} /></label>
                <label className="lg-check"><input type="checkbox" checked={retForm.damaged} onChange={(e) => setRetForm({ ...retForm, damaged: e.target.checked })} /> 归还时设备损坏 → 自动转入维修并保留原借还链</label>
                {retForm.damaged && <label>损坏情况<textarea rows="2" value={retForm.reason} placeholder="如：扬声器破音 / 屏幕碎裂" onChange={(e) => setRetForm({ ...retForm, reason: e.target.value })} /></label>}
                <div className="lg-modal-ops"><button className="secondary" onClick={() => setModal(null)}>取消</button>
                  <button className="primary" onClick={doReturn}>{retForm.damaged ? '确认归还并转修' : '确认归还'}</button></div>
              </>
            )}
            {modal.type === 'handover' && (
              <>
                <h3>跨班交接 · {modal.loan.code}</h3>
                <p className="dim small">交出：{modal.loan.receiver}（{modal.loan.shift}）· 借还单 {modal.loan.id}</p>
                {modalErr.length > 0 && <div className="lg-alert"><ConflictTable rows={modalErr} empty="" /></div>}
                <label>领取人（新）<input value={hoForm.receiver} placeholder="必填" onChange={(e) => setHoForm({ ...hoForm, receiver: e.target.value })} /></label>
                <label>接入班次
                  <select value={hoForm.toShift} onChange={(e) => setHoForm({ ...hoForm, toShift: e.target.value })}>
                    {shifts.map((s) => <option key={s.name}>{s.name}</option>)}
                  </select>
                </label>
                <label>预计归还时间<input type="datetime-local" value={hoForm.returnAt} onChange={(e) => setHoForm({ ...hoForm, returnAt: e.target.value })} /></label>
                <div className="lg-modal-ops"><button className="secondary" onClick={() => setModal(null)}>取消</button>
                  <button className="primary" onClick={doHandover}>确认交接</button></div>
              </>
            )}
            {modal.type === 'rebind' && (
              <>
                <h3>换绑 · {modal.loan.code}</h3>
                <p className="dim small">先释放「{modal.loan.exhibitTitle}」（{modal.loan.id}），再绑定新展项，新借还单接续原链。</p>
                {modalErr.length > 0 && <div className="lg-alert"><strong>换绑被规则拦截：</strong><ConflictTable rows={modalErr} empty="" /></div>}
                <label>新展项
                  <select value={rbForm.exhibitId} onChange={(e) => setRbForm({ ...rbForm, exhibitId: Number(e.target.value) })}>
                    {exhibits.map((x) => <option key={x.id} value={x.id}>{x.title}（{x.status}）</option>)}
                  </select>
                </label>
                <label>新应归还时间<input type="datetime-local" value={rbForm.end} onChange={(e) => setRbForm({ ...rbForm, end: e.target.value })} /></label>
                <div className="lg-modal-ops"><button className="secondary" onClick={() => setModal(null)}>取消</button>
                  <button className="primary" onClick={doRebind}>释放并换绑</button></div>
              </>
            )}
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
