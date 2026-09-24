<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2>周期账单</h2>
        <p class="page-sub">工资、房租、水电等固定账单到期自动入账，余额同步更新</p>
      </div>
      <button class="btn btn-primary" @click="openCreate">＋ 新建周期账单</button>
    </div>

    <div class="card list-card">
      <h3 class="list-title">账单列表</h3>
      <div class="rb-list">
        <div v-for="b in views" :key="b.id" class="rb-item">
          <div class="rb-icon" :class="b.type">{{ b.type === 'income' ? '收' : '支' }}</div>
          <div class="rb-main">
            <div class="rb-title">
              <span>{{ b.label }}</span>
              <span class="badge" :class="b.active ? 'badge-on' : 'badge-off'">{{ b.active ? '启用中' : '已停用' }}</span>
            </div>
            <div class="rb-meta">
              {{ b.cycleText }} · {{ b.accountName }} · {{ b.category }}
              <template v-if="b.active"> · 下次 {{ b.nextDue || '—' }}</template>
              <template v-else> · 最近生成 {{ b.lastGenerated || '无' }}</template>
            </div>
          </div>
          <div class="rb-amount" :class="b.type">
            {{ b.type === 'income' ? '+' : '-' }}¥{{ money(b.amount) }}
          </div>
          <div class="rb-actions">
            <button class="link-btn" @click="toggle(b)">{{ b.active ? '停用' : '启用' }}</button>
            <button class="link-btn" @click="openEdit(b)">编辑</button>
            <button class="link-btn danger" @click="remove(b)">删除</button>
          </div>
        </div>
        <div v-if="views.length === 0" class="empty-row">暂无周期账单，点击右上角新建一条吧</div>
      </div>
      <p class="tip">说明：到期当天打开应用即自动生成一笔流水并更新账户余额；同一天不会重复生成。停用或删除账单后，已生成的记录保持不变。</p>
    </div>

    <Modal :title="editing ? '编辑周期账单' : '新建周期账单'" @close="modalOpen = false" v-if="modalOpen">
      <form id="rb-form" @submit.prevent="submit" class="form">
        <label class="field">
          <span>账单名称</span>
          <input v-model="form.name" required placeholder="如：每月房租 / 工资" />
        </label>

        <div class="seg type-seg">
          <button type="button" class="seg-btn wide" :class="{ active: form.type === 'income' }" @click="switchType('income')">收入</button>
          <button type="button" class="seg-btn wide" :class="{ active: form.type === 'expense' }" @click="switchType('expense')">支出</button>
        </div>

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
          <select v-model="form.cycle">
            <option v-for="c in RECURRING_CYCLE_OPTIONS" :key="c.value" :value="c.value">{{ c.label }}</option>
          </select>
        </label>

        <label class="field" v-if="form.cycle === 'monthly'">
          <span>每月几号扣款（1–28 日）</span>
          <select v-model.number="form.anchorDay">
            <option v-for="d in monthDays" :key="d" :value="d">{{ d }} 日</option>
          </select>
        </label>

        <label class="field" v-if="form.cycle === 'weekly'">
          <span>每周哪一天</span>
          <select v-model="form.anchorWeekday">
            <option v-for="w in WEEKDAY_OPTIONS" :key="w.value" :value="w.value">{{ w.label }}</option>
          </select>
        </label>

        <label class="field">
          <span>开始日期</span>
          <input v-model="form.startDate" type="date" required />
        </label>

        <label class="field">
          <span>备注</span>
          <input v-model="form.note" placeholder="选填" />
        </label>
      </form>

      <template #footer>
        <button type="button" class="btn" @click="modalOpen = false">取消</button>
        <button type="submit" class="btn btn-primary" form="rb-form">保存</button>
      </template>
    </Modal>
  </div>
</template>

<script setup>
import { reactive, ref, computed } from 'vue'
import { useStore, refreshKeys, controllersApi } from '../data/store.js'
import { money } from '../core/utils.js'
import { INCOME_CATEGORIES, EXPENSE_CATEGORIES, TRANSACTION_TYPES, RECURRING_CYCLE_OPTIONS, WEEKDAY_OPTIONS } from '../core/constants.js'
import Modal from '../components/Modal.vue'

const store = useStore()
const { recurring: recurringApi } = controllersApi

const modalOpen = ref(false)
const editing = ref(null)
const form = reactive(recurringApi.emptyRecurringForm())

const monthDays = Array.from({ length: 28 }, (_, i) => i + 1)
const currentCategories = computed(() => (form.type === TRANSACTION_TYPES.INCOME ? INCOME_CATEGORIES : EXPENSE_CATEGORIES))
const views = computed(() =>
  recurringApi.billViews().sort((a, b) => Number(b.active) - Number(a.active) || b.createdAt - a.createdAt)
)

const switchType = (type) => {
  form.type = type
  form.category = type === TRANSACTION_TYPES.INCOME ? INCOME_CATEGORIES[0] : EXPENSE_CATEGORIES[0]
}

const resetForm = () => {
  Object.assign(form, recurringApi.emptyRecurringForm(), { accountId: store.accounts[0]?.id || '' })
}

const openCreate = () => {
  editing.value = null
  resetForm()
  modalOpen.value = true
}

const openEdit = (b) => {
  editing.value = b
  Object.assign(form, {
    name: b.name,
    type: b.type,
    accountId: b.accountId,
    amount: b.amount,
    category: b.category,
    cycle: b.cycle,
    anchorDay: b.anchorDay,
    anchorWeekday: b.anchorWeekday,
    startDate: b.startDate,
    note: b.note
  })
  modalOpen.value = true
}

const submit = () => {
  if (!form.accountId || !form.amount || Number(form.amount) <= 0) return
  if (editing.value) recurringApi.updateRecurringBill(editing.value.id, form)
  else recurringApi.addRecurringBill(form)
  refreshKeys('recurringBills')
  modalOpen.value = false
}

const toggle = (b) => {
  recurringApi.setRecurringActive(b.id, !b.active)
  refreshKeys('recurringBills')
}

const remove = (b) => {
  if (recurringApi.removeRecurringBill(b.id)) refreshKeys('recurringBills')
}
</script>

<style scoped>
.list-card {
  padding-bottom: 12px;
}
.list-title {
  margin: 0 0 6px;
  font-size: 15px;
}
.rb-list {
  display: flex;
  flex-direction: column;
}
.rb-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 4px;
  border-bottom: 1px solid var(--border-color);
  flex-wrap: wrap;
}
.rb-item:last-child {
  border-bottom: none;
}
.rb-icon {
  width: 38px;
  height: 38px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  color: #fff;
  flex-shrink: 0;
}
.rb-icon.income { background: var(--income); }
.rb-icon.expense { background: var(--expense); }
.rb-main {
  flex: 1;
  min-width: 200px;
}
.rb-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 14px;
}
.badge-on { color: var(--accent); background: rgba(79, 141, 249, 0.12); }
.badge-off { color: var(--text-secondary); }
.rb-meta {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
}
.rb-amount {
  font-weight: 800;
  white-space: nowrap;
}
.rb-amount.income { color: var(--income); }
.rb-amount.expense { color: var(--expense); }
.rb-actions {
  display: flex;
  gap: 10px;
}
.tip {
  margin: 10px 4px 0;
  font-size: 12px;
  color: var(--text-secondary);
}
.empty-row {
  text-align: center;
  color: var(--text-secondary);
  padding: 24px 0;
  font-size: 13px;
}
</style>
