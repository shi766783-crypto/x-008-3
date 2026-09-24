import { storage } from '../../core/storage.js'
import { uid, todayStr, toDateStr } from '../../core/utils.js'
import { STORAGE_KEYS, TRANSACTION_TYPES, LARGE_EXPENSE_THRESHOLD } from '../../core/constants.js'
import { addTransaction } from './transactionController.js'

export const emptyRecurringForm = () => ({
  name: '',
  type: TRANSACTION_TYPES.EXPENSE,
  accountId: '',
  amount: '',
  category: '住房',
  period: 'monthly',
  startDate: todayStr(),
  note: ''
})

export function loadRecurringBills() {
  return storage.getJSON(STORAGE_KEYS.recurringBills) || []
}

export function saveRecurringBills(bills) {
  storage.setJSON(STORAGE_KEYS.recurringBills, bills)
}

export function periodLabel(period) {
  const map = { weekly: '每周', monthly: '每月', yearly: '每年' }
  return map[period] || period
}

export function normalizeRecurring(form) {
  return {
    id: uid(),
    name: String(form.name || '').trim(),
    type: form.type,
    accountId: form.accountId,
    amount: Number(form.amount) || 0,
    category: form.category || '',
    period: form.period,
    startDate: form.startDate || todayStr(),
    note: String(form.note || '').trim(),
    active: true,
    createdAt: Date.now(),
    // 已生成过流水的到期日，保证同一天不会重复生成（即使流水被删除）
    generatedDates: []
  }
}

function daysInMonth(year, monthZeroBased) {
  return new Date(year, monthZeroBased + 1, 0).getDate()
}

// 从某个基准日（周期起点或重新启用日）起，按周期逐个给出到期日
function advance(base, period, step) {
  const d = new Date(`${base}T00:00:00`)
  if (period === 'weekly') {
    d.setDate(d.getDate() + step * 7)
  } else if (period === 'monthly') {
    const day = d.getDate()
    const targetMonth = d.getMonth() + step
    d.setMonth(targetMonth, 1)
    d.setDate(Math.min(day, daysInMonth(d.getFullYear(), d.getMonth())))
  } else if (period === 'yearly') {
    const day = d.getDate()
    const month = d.getMonth()
    d.setFullYear(d.getFullYear() + step, month, 1)
    d.setDate(Math.min(day, daysInMonth(d.getFullYear(), month)))
  }
  return toDateStr(d)
}

export function occurrencesOnOrAfter(anchor, period, limitStr = todayStr()) {
  const out = []
  for (let i = 0; i < 100000; i++) {
    const date = advance(anchor, period, i)
    if (date > limitStr) break
    out.push(date)
  }
  return out
}

// 找到从 originalAnchor 的周期序列中，第一个不早于 from 的到期日，
// 用于重新启用 / 修改规则后对齐到原节奏（避免把启用当天当成新的扣款日）
function firstOccurrenceOnOrAfter(originalAnchor, period, from = todayStr()) {
  for (let i = 0; i < 100000; i++) {
    const date = advance(originalAnchor, period, i)
    if (date >= from) return date
  }
  return from
}

export function nextOccurrence(bill, fromStr = todayStr()) {
  const anchor = bill.resumeFrom || bill.startDate
  for (let i = 0; i < 100000; i++) {
    const date = advance(anchor, bill.period, i)
    if (date >= fromStr) return date
  }
  return null
}

export function addRecurring(form) {
  const bill = normalizeRecurring(form)
  saveRecurringBills([...loadRecurringBills(), bill])
  return bill
}

export function updateRecurring(id, form) {
  const startDate = form.startDate || todayStr()
  const bills = loadRecurringBills().map((b) =>
    b.id === id
      ? {
          ...b,
          name: String(form.name || '').trim(),
          type: form.type,
          accountId: form.accountId,
          amount: Number(form.amount) || 0,
          category: form.category || '',
          period: form.period,
          startDate,
          note: String(form.note || '').trim(),
          // 周期规则被改动后，从今天起对齐到新节奏，已生成过的日期不重复
          resumeFrom: firstOccurrenceOnOrAfter(startDate, form.period),
          generatedDates: []
        }
      : b
  )
  saveRecurringBills(bills)
}

export function setActive(id, active, today = todayStr()) {
  const bills = loadRecurringBills().map((b) => {
    if (b.id !== id) return b
    if (!active) return { ...b, active: false }
    // 重新启用：对齐到原周期下一个到期日，不补停用期间的流水
    const resumeFrom = firstOccurrenceOnOrAfter(b.startDate, b.period, today)
    return { ...b, active: true, resumeFrom }
  })
  saveRecurringBills(bills)
}

// 删除周期账单只停用并移除配置；已生成的流水保持原样
export function removeRecurring(id, confirmFn = window.confirm) {
  const bill = loadRecurringBills().find((b) => b.id === id)
  if (!bill) return false
  if (!confirmFn(`确认删除周期账单「${bill.name}」吗？已生成的记账记录会保留。`)) return false
  saveRecurringBills(loadRecurringBills().filter((b) => b.id !== id))
  return true
}

function buildTransaction(bill, date) {
  const isLarge = bill.type === TRANSACTION_TYPES.EXPENSE && bill.amount >= LARGE_EXPENSE_THRESHOLD
  const note = bill.note || `周期账单 · ${bill.name}`
  return {
    type: bill.type,
    accountId: bill.accountId,
    amount: bill.amount,
    category: bill.category,
    date,
    note,
    isLarge,
    recurringBillId: bill.id
  }
}

// 检查所有启用中的周期账单，把已到期但尚未生成的流水补齐。
// 返回本次新生成的流水数量。
export function generateDueBills(today = todayStr()) {
  const bills = loadRecurringBills()
  if (bills.length === 0) return 0

  let changed = false
  let created = 0
  const nextBills = bills.map((bill) => {
    if (!bill.active) return bill
    const anchor = bill.resumeFrom || bill.startDate
    if (anchor > today) return bill

    const dueDates = occurrencesOnOrAfter(anchor, bill.period, today)
    const pending = dueDates.filter((d) => !bill.generatedDates.includes(d))
    if (pending.length === 0) return bill

    for (const date of pending) {
      const tx = addTransaction(buildTransaction(bill, date))
      if (tx) created += 1
    }
    changed = true
    return { ...bill, generatedDates: [...bill.generatedDates, ...pending].sort() }
  })

  if (changed) saveRecurringBills(nextBills)
  return created
}
