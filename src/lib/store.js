import { useEffect, useState } from 'react';
import {
  seedExhibits, seedDevices, seedShifts, buildSeedLoans, buildSeedRepairs,
} from './domain.js';

const KEY = 'guide-exhibits'; // 沿用原工作台存储键，老数据自动迁移
const VERSION = 2;

function fresh() {
  return {
    version: VERSION,
    exhibits: seedExhibits,
    devices: seedDevices,
    loans: buildSeedLoans(),
    repairs: buildSeedRepairs(),
    shifts: seedShifts,
  };
}

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (raw && raw.version === VERSION) return raw;
    // v1：原展项工作台数据（数组）。保留其展项编辑，补齐台账域。
    const base = fresh();
    if (Array.isArray(raw)) base.exhibits = raw;
    return base;
  } catch {
    return fresh();
  }
}

export function useStore() {
  const [state, setState] = useState(load);

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify({ ...state, version: VERSION }));
  }, [state]);

  const patch = (p) => setState((s) => (typeof p === 'function' ? p(s) : { ...s, ...p }));
  const reset = () => setState(fresh());
  return { ...state, patch, reset };
}
