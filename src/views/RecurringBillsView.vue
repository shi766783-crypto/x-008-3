<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2>周期账单</h2>
        <p class="page-sub">工资、房租、水电等固定收支，到期自动记账并更新余额</p>
      </div>
      <button class="btn btn-primary" @click="openCreate">＋ 新建周期账单</button>
    </div>

    <div class="grid bill-grid">
      <div v-for="bill in views" :key="bill.id" class="card bill-card" :class="{ off: !bill.active }">
        <div class="bill-top">
          <div class="bill-title">
            <span class="bill-name">{{ bill.name }}</span>
            <span class="badge" :class="bill.type === 'income' ? 'badge-income' : 'badge-expense'">
              {{ bill.type === 'income' ? '收入' : '支出' }}
            </span>
            <span v-if="!bill.active" class="badge">已停用</span>
          </div>
          <div class="bill-amount" :class="bill.type">
            {{ bill.type === 'income' ? '+' : '-' }}¥{{ money(bill.amount) }}
          </div>
        </div>

        <div class="bill-meta">
          <span>{{ periodLabel(bill.period) }}</span>
          <span>{{ bill.category || '未分类' }}</span>
          <span>{{ accountName(bill.accountId) }}</span>
          <span>下次 {{ bill.nextDue || '—' }}</span>
        </div>

        <div class="bill-foot">
          <label class="switch">
            <input type="checkbox" :checked="bill.active" @change="toggle(bill)" />
            <span>{{ bill.active ? '启用中' : '已停用' }}</span>
          </label>
          <div class="bill-actions">
            <button class="link-btn" @click="openEdit(bill)">编辑</button>
            <button class="link-btn danger" @click="remove(bill)">删除</button>
          </div>
        </div>
      </div>
    </div>

    <div class="card empty" v-if="views.length === 0">
      <p>还没有周期账单，点击右上角「新建周期账单」，设置后到期将自动记账。</p>
    </div>

    <Modal :title="editing ? '编辑周期账单' : '新建周期账单'" @close="modalOpen = false" v-if="modalOpen">
      <form id="recurring-form" @submit.prevent="submit" class="form">
        <label class="field">
          <span>名称</span>
          <input v-model="form.name" required placeholder="如：每月房租、月度工资" />
        </label>

        <label class="field">
          <span>类型</span>
          <div class="seg">
            <button type="button" class="seg-btn wide" :class="{ active: form.type === 'expense' }" @click="switchType('expense')">支出</button>
            <button type="button" class="seg-btn wide" :class="{ active: form.type === 'income' }" @click="switchType('income')">收入</button>
          </div>
        </label>

        <label class="field">
          <span>账户</span>
          <select v-model="form.accountId" required>
            <option value="" disabled>选择账户</option>
            <option v-for="a in store.accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
          </select>
        </label>

        <label class="field">
          <span>金额</span>
          <input v-model.number="form.amount" type="number" min="0.01" step="0.01" required placeholder="0.00" />
        </label>

        <label class="field">
          <span>类别</span>
          <select v-model="form.category">
            <option v-for="c in currentCategories" :key="c" :value="c">{{ c }}</option>
          </select>
        </label>

        <label class="field">
          <span>周期</span>
          <div class="seg">
            <button v-for="p in RECUR_PERIODS" :key="p.value" type="button" class="seg-btn" :class="{ active: form.period === p.value }" @click="form.period = p.value">
              {{ p.label }}
            </button>
          </div>
        </label>

        <label class="field">
          <span>开始日期（首个扣款日）</span>
          <input v-model="form.startDate" type="date" required />
        </label>

        <label class="field">
          <span>备注</span>
          <input v-model="form.note" placeholder="选填，生成流水时会作为备注" />
        </label>
      </form>

      <template #footer>
        <button type="button" class="btn" @click="modalOpen = false">取消</button>
        <button type="submit" class="btn btn-primary" form="recurring-form">保存</button>
      </template>
    </Modal>
  </div>
</template>

<script setup>
import { reactive, ref, computed, onMounted } from 'vue'
import { useStore, refreshKeys, controllersApi } from '../data/store.js'
import { money, todayStr } from '../core/utils.js'
import { INCOME_CATEGORIES, EXPENSE_CATEGORIES, RECUR_PERIODS, TRANSACTION_TYPES } from '../core/constants.js'
import Modal from '../components/Modal.vue'

const store = useStore()
const { recurring: recurringApi } = controllersApi

const modalOpen = ref(false)
const editing = ref(null)
const form = reactive(recurringApi.emptyRecurringForm())

const currentCategories = computed(() => (form.type === TRANSACTION_TYPES.INCOME ? INCOME_CATEGORIES : EXPENSE_CATEGORIES))

const accountName = (id) => store.accounts.find((a) => a.id === id)?.name || '未知账户'
const periodLabel = (p) => recurringApi.periodLabel(p)

const views = computed(() =>
  [...store.recurringBills]
    .map((b) => ({ ...b, nextDue: b.active ? recurringApi.nextOccurrence(b) : null }))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
)

const runGeneration = () => {
  const count = recurringApi.generateDueBills()
  if (count > 0) {
    refreshKeys('recurringBills', 'transactions', 'accounts')
    controllersApi.achievement.updateAchievements()
    refreshKeys('achievements', 'points')
  } else {
    refreshKeys('recurringBills')
  }
}

onMounted(runGeneration)

const switchType = (type) => {
  form.type = type
  form.category = type === TRANSACTION_TYPES.INCOME ? INCOME_CATEGORIES[0] : '住房'
}

const openCreate = () => {
  editing.value = null
  Object.assign(form, recurringApi.emptyRecurringForm(), { accountId: store.accounts[0]?.id || '' })
  modalOpen.value = true
}

const openEdit = (bill) => {
  editing.value = bill
  Object.assign(form, {
    name: bill.name,
    type: bill.type,
    accountId: bill.accountId,
    amount: bill.amount,
    category: bill.category,
    period: bill.period,
    startDate: bill.startDate,
    note: bill.note
  })
  modalOpen.value = true
}

const submit = () => {
  if (!form.accountId || !form.amount) return
  if (editing.value) recurringApi.updateRecurring(editing.value.id, form)
  else recurringApi.addRecurring(form)
  modalOpen.value = false
  runGeneration()
}

const toggle = (bill) => {
  recurringApi.setActive(bill.id, !bill.active)
  runGeneration()
}

const remove = (bill) => {
  if (recurringApi.removeRecurring(bill.id)) refreshKeys('recurringBills')
}
</script>

<style scoped>
.bill-grid {
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
}
.bill-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.bill-card.off { opacity: 0.62; }
.bill-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
}
.bill-title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.bill-name {
  font-size: 16px;
  font-weight: 700;
}
.badge-income {
  color: var(--income);
  background: rgba(58, 166, 111, 0.12);
}
.badge-expense {
  color: var(--expense);
  background: rgba(224, 82, 96, 0.12);
}
.bill-amount {
  font-size: 18px;
  font-weight: 800;
  white-space: nowrap;
}
.bill-amount.income { color: var(--income); }
.bill-amount.expense { color: var(--expense); }
.bill-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  font-size: 12px;
  color: var(--text-secondary);
}
.bill-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-top: 1px solid var(--border-color);
  padding-top: 10px;
}
.switch {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
}
.bill-actions {
  display: flex;
  gap: 10px;
}
</style>
