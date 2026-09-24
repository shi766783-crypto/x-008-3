import { storage } from '../../core/storage.js'
import { uid, todayStr, toDateStr } from '../../core/utils.js'
import { STORAGE_KEYS, TRANSACTION_TYPES, RECURRING_CYCLES, INCOME_CATEGORIES, EXPENSE_CATEGORIES } from '../../core/constants.js'
import { loadAccounts } from './accountController.js'
import { loadTransactions, addTransaction } from './transactionController.js'

const MAX_DAY = 28

export const emptyRecurringForm = () => ({
  name: '',
  type: TRANSACTION_TYPES.EXPENSE,
  accountId: '',
  amount: '',
  category: EXPENSE_CATEGORIES[0],
  cycle: RECURRING_CYCLES.MONTHLY,
  anchorDay: 1,
  anchorWeekday: '1',
  startDate: todayStr(),
  note: ''
})

export function loadRecurringBills() {
  return storage.getJSON(STORAGE_KEYS.recurringBills) || []
}

export function saveRecurringBills(bills) {
  storage.setJSON(STORAGE_KEYS.recurringBills, bills)
}

export function normalizeRecurring(form) {
  const isIncome = form.type === TRANSACTION_TYPES.INCOME
  const categories = isIncome ? INCOME_CATEGORIES : EXPENSE_CATEGORIES
  const anchorDay = Math.min(MAX_DAY, Math.max(1, Number(form.anchorDay) || 1))
  return {
    id: uid(),
    name: String(form.name || '').trim(),
    type: isIncome ? TRANSACTION_TYPES.INCOME : TRANSACTION_TYPES.EXPENSE,
    accountId: form.accountId,
    amount: Number(form.amount) || 0,
    category: categories.includes(form.category) ? form.category : categories[0],
    cycle: form.cycle || RECURRING_CYCLES.MONTHLY,
    anchorDay,
    anchorWeekday: String(form.anchorWeekday ?? '1'),
    startDate: form.startDate || todayStr(),
    note: String(form.note || '').trim(),
    active: true,
    createdAt: Date.now()
  }
}

export function addRecurringBill(form) {
  if (!form.accountId || !Number(form.amount)) return null
  const bill = normalizeRecurring(form)
  saveRecurringBills([...loadRecurringBills(), bill])
  return bill
}

export function updateRecurringBill(id, form) {
  if (!form.accountId || !Number(form.amount)) return null
  const normalized = normalizeRecurring(form)
  const bills = loadRecurringBills().map((b) =>
    b.id === id
      ? {
          ...b,
          name: normalized.name,
          type: normalized.type,
          accountId: normalized.accountId,
          amount: normalized.amount,
          category: normalized.category,
          cycle: normalized.cycle,
          anchorDay: normalized.anchorDay,
          anchorWeekday: normalized.anchorWeekday,
          startDate: normalized.startDate,
          note: normalized.note
        }
      : b
  )
  saveRecurringBills(bills)
  return bills.find((b) => b.id === id) || null
}

export function setRecurringActive(id, active) {
  const bills = loadRecurringBills().map((b) => (b.id === id ? { ...b, active: Boolean(active) } : b))
  saveRecurringBills(bills)
}

export function removeRecurringBill(id, confirmFn = window.confirm) {
  const bill = loadRecurringBills().find((b) => b.id === id)
  if (!bill) return false
  if (!confirmFn(`确认删除周期账单「${bill.name || bill.category}」吗？已生成的记账记录会保留。`)) return false
  saveRecurringBills(loadRecurringBills().filter((b) => b.id !== id))
  return true
}

function parseDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** 判断账单在某一天是否到期（startDate 当天或之后才可能触发） */
export function isDueOn(bill, dateStr) {
  if (!bill.active) return false
  if (bill.startDate && dateStr < bill.startDate) return false
  const d = parseDate(dateStr)
  if (bill.cycle === RECURRING_CYCLES.DAILY) return true
  if (bill.cycle === RECURRING_CYCLES.WEEKLY) return String(d.getDay()) === String(bill.anchorWeekday)
  return d.getDate() === (Number(bill.anchorDay) || 1)
}

/** 下一个到期日（若 fromDate 当天到期则返回当天） */
export function nextDueDate(bill, fromDateStr = todayStr()) {
  for (let i = 0; i <= 400; i++) {
    const base = parseDate(fromDateStr)
    base.setDate(base.getDate() + i)
    const dateStr = toDateStr(base)
    if (isDueOn(bill, dateStr)) return dateStr
  }
  return ''
}

function generatedDates(billId) {
  return new Set(
    loadTransactions()
      .filter((t) => t.recurringId === billId)
      .map((t) => t.date)
  )
}

/**
 * 生成指定日期到期的周期账单流水。
 * 同一账单同一天只生成一笔（依据已存在的 recurringId + 日期），重复调用安全。
 * 返回本次新生成的流水列表。
 */
export function generateDueBills(dateStr = todayStr()) {
  const accountIds = new Set(loadAccounts().map((a) => a.id))
  const created = []
  for (const bill of loadRecurringBills()) {
    if (!isDueOn(bill, dateStr)) continue
    if (!accountIds.has(bill.accountId)) continue
    if (generatedDates(bill.id).has(dateStr)) continue
    const tx = addTransaction(
      {
        type: bill.type,
        accountId: bill.accountId,
        amount: bill.amount,
        category: bill.category,
        date: dateStr,
        note: bill.note,
        isLarge: bill.type === TRANSACTION_TYPES.EXPENSE && bill.amount >= 1000
      },
      { recurringId: bill.id, recurringName: bill.name }
    )
    if (tx) created.push(tx)
  }
  return created
}

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export function cycleText(bill) {
  if (bill.cycle === RECURRING_CYCLES.MONTHLY) return `每月 ${Number(bill.anchorDay)} 日`
  if (bill.cycle === RECURRING_CYCLES.WEEKLY) return `每${WEEKDAY_LABELS[Number(bill.anchorWeekday)] || '周一'}`
  return '每天'
}

/** 列表展示用：补充账户名、周期文案、下次到期日、最近生成日期 */
export function billViews() {
  const accounts = loadAccounts()
  const txs = loadTransactions()
  return loadRecurringBills().map((bill) => {
    const account = accounts.find((a) => a.id === bill.accountId)
    const ownDates = txs.filter((t) => t.recurringId === bill.id).map((t) => t.date).sort()
    const label = bill.name || bill.category
    return {
      ...bill,
      label,
      accountName: account ? account.name : '未知账户',
      cycleText: cycleText(bill),
      nextDue: bill.active ? nextDueDate(bill) : '',
      lastGenerated: ownDates.length ? ownDates[ownDates.length - 1] : ''
    }
  })
}
