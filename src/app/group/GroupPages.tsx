import { useEffect, useState, useRef } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../context';
import { Arrow } from '../components';
import { formatAmount } from '../../shared/amount';
import {
  GROUP_ASSET,
  DraftError,
  draftKey,
  readDrafts,
  saveDraft,
  deleteDraft,
  exportDraft,
  importDraft,
  newGroupFields,
  fieldsFromData,
  validateGroupFields,
} from '../../shared/group/draft';
import type {
  GroupData,
  GroupDraft,
  GroupFields,
  GroupErrors,
  GroupField,
} from '../../shared/group/draft';
import './group.css';

type Translator = (en: string, zh: string) => string;
function message(error: unknown, t: Translator): string {
  const code = error instanceof DraftError ? error.code : 'UNAVAILABLE';
  const texts = {
    UNAVAILABLE: [
      'Browser storage or safe multi-tab saving is unavailable. Export your fields or use a supported browser; nothing has been published.',
      '浏览器存储或安全的跨标签保存不可用。请备份填写内容或更换浏览器；没有发布任何收款。',
    ],
    CORRUPT: [
      'Stored drafts could not be read. They have not been erased or overwritten.',
      '无法读取已存草稿，原数据没有被删除或覆盖。',
    ],
    CONFLICT: [
      'This draft changed in another tab. Reload before editing again; newer changes were not overwritten.',
      '草稿已在其他标签页修改，请刷新后再编辑；没有覆盖新版本。',
    ],
    LIMIT: [
      'This browser already has 40 drafts. Export and remove an old draft first.',
      '此浏览器已有 40 份草稿，请先导出并删除旧草稿。',
    ],
    INVALID_IMPORT: [
      'Not a valid MonadBox testnet Group draft (maximum 16 KB). No draft was imported.',
      '不是有效的 MonadBox 测试网成团草稿（最大 16 KB），未导入任何记录。',
    ],
  } as const;
  return t(texts[code][0], texts[code][1]);
}
async function locked<T>(key: string, action: () => T): Promise<T> {
  if (!navigator.locks) throw new DraftError('UNAVAILABLE');
  return navigator.locks.request(key, action);
}
function download(data: GroupData, id: string) {
  const url = URL.createObjectURL(new Blob([exportDraft(data)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `monadbox-group-${id}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function useDrafts() {
  const { state, t } = useApp();
  const key = state.status === 'ready' ? draftKey(state.config.environment) : null;
  const [rows, setRows] = useState<GroupDraft[]>([]),
    [error, setError] = useState(''),
    [loaded, setLoaded] = useState(false);
  const refresh = () => {
    if (!key) return;
    try {
      setRows(readDrafts(localStorage, key));
      setError('');
    } catch (e) {
      setError(message(e, t));
    }
    setLoaded(true);
  };
  useEffect(() => {
    if (!key) return;
    const read = () => {
      try {
        setRows(readDrafts(localStorage, key));
        setError('');
      } catch (e) {
        setError(message(e, t));
      }
      setLoaded(true);
    };
    read();
    const onStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) read();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [key, t]);
  return { key, rows, error, loaded, refresh };
}
export function GroupRules() {
  const { t } = useApp();
  return (
    <ul className="group-rules">
      <li>
        {t(
          'Before the deadline: a participant may leave and claim their full principal. Leaving is final for that wallet.',
          '截止前可退出并领取全部本金；同一钱包退出后不能重新加入。',
        )}
      </li>
      <li>
        {t(
          'Below target at the deadline: remaining participants may claim a refund.',
          '截止时未成团：剩余参与者可领取退款。',
        )}
      </li>
      <li>
        {t(
          'Target reached: funds stay reserved until the agreed settlement time, then become claimable by the fixed beneficiary.',
          '成团成功：资金保留至约定结算时间，再归属固定收款人领取。',
        )}
      </li>
      <li>
        {t(
          'Successful collection is not proof of service delivery. After the deadline there is no unconditional participant refund.',
          '成团成功不代表服务已交付；截止后参与者不再享有无条件退款。',
        )}
      </li>
      <li>
        {t(
          'The creator may cancel before settlement. Claimable credit is not money already in a wallet; withdrawing is a separate transaction.',
          '创建者可在结算前取消。可领取款不等于钱包已到账，提款是单独交易。',
        )}
      </li>
    </ul>
  );
}
export function GroupSummary({ data }: { data: GroupData }) {
  const { t, locale } = useApp();
  const local = (seconds: number) =>
    new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-GB', {
      dateStyle: 'medium',
      timeStyle: 'long',
    }).format(new Date(seconds * 1000));
  return (
    <div className="group-summary">
      <h2>{data.title}</h2>
      <p className="group-description">
        {data.description || t('No description added.', '未填写说明。')}
      </p>
      <dl>
        <div>
          <dt>{t('Each participant', '每人金额')}</dt>
          <dd>
            {formatAmount(BigInt(data.unitPrice), 6)} {t('test AUSD', '测试 AUSD')}
          </dd>
        </div>
        <div>
          <dt>{t('Target / capacity', '成团人数 / 上限')}</dt>
          <dd>
            {data.minimum} / {data.capacity}
          </dd>
        </div>
        <div>
          <dt>{t('Target amount (not collected)', '成团目标金额（尚未收款）')}</dt>
          <dd>
            {formatAmount(BigInt(data.unitPrice) * BigInt(data.minimum), 6)}{' '}
            {t('test AUSD', '测试 AUSD')}
          </dd>
        </div>
        <div>
          <dt>{t('Maximum collection', '最大收款金额')}</dt>
          <dd>
            {formatAmount(BigInt(data.unitPrice) * BigInt(data.capacity), 6)}{' '}
            {t('test AUSD', '测试 AUSD')}
          </dd>
        </div>
        <div>
          <dt>{t('Fixed beneficiary', '固定收款地址')}</dt>
          <dd className="mono">{data.beneficiary}</dd>
        </div>
        {[
          ['startsAt', t('Collection starts', '募集开始')],
          ['fundingDeadline', t('Collection deadline', '募集截止')],
          ['settleNotBefore', t('Earliest settlement', '最早结算')],
        ].map(([field, label]) => {
          const seconds = data[field as 'startsAt' | 'fundingDeadline' | 'settleNotBefore'];
          return (
            <div key={field}>
              <dt>{label}</dt>
              <dd>
                {local(seconds)}
                <small>{new Date(seconds * 1000).toISOString().replace('.000Z', ' UTC')}</small>
              </dd>
            </div>
          );
        })}
      </dl>
      <details>
        <summary>{t('Network and candidate asset', '网络与候选资产')}</summary>
        <p>Monad Testnet · 10143</p>
        <p className="mono">{GROUP_ASSET}</p>
        <p>
          {t(
            'Candidate test token only. No asset or business contract is enabled for payments.',
            '仅为候选测试代币，尚未开放业务付款资产或合约。',
          )}
        </p>
      </details>
    </div>
  );
}
const steps = [
  ['Basics', '基本信息'],
  ['Funding', '募集规则'],
  ['Beneficiary', '收款人'],
  ['Review', '核对预览'],
] as const;
const fieldsByStep: GroupField[][] = [
  ['title', 'description'],
  ['amount', 'minimum', 'capacity', 'startsAt', 'fundingDeadline', 'settleNotBefore'],
  ['beneficiary'],
  [],
];
export function GroupBuilderPage() {
  const { draftId } = useParams();
  const { t, state } = useApp();
  const repo = useDrafts();
  if (!repo.loaded)
    return (
      <div className="container group-page">
        <p>
          {state.status === 'error'
            ? t(
                'Configuration is unavailable. No draft has been changed.',
                '配置不可用，没有修改草稿。',
              )
            : t('Loading drafts…', '正在读取草稿…')}
        </p>
      </div>
    );
  if (repo.error)
    return (
      <div className="container group-page">
        <p role="alert">{repo.error}</p>
        <Link to="/app/group-drafts">{t('Back to drafts', '返回草稿')}</Link>
      </div>
    );
  const old = draftId ? repo.rows.find((r) => r.id === draftId) : undefined;
  if (draftId && !old) return <DraftMissing />;
  return <Builder key={`${repo.key}:${draftId ?? 'new'}`} storageKey={repo.key!} initial={old} />;
}
function Builder({ storageKey, initial }: { storageKey: string; initial: GroupDraft | undefined }) {
  const { t, locale, state } = useApp();
  const navigate = useNavigate();
  const baseDraft = useRef(initial).current;
  const [fields, setFields] = useState<GroupFields>(() =>
    initial ? fieldsFromData(initial.data) : newGroupFields(),
  );
  const [step, setStep] = useState(0),
    [errors, setErrors] = useState<GroupErrors>({}),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const update = (key: GroupField, value: string) => {
    setFields((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
    setDirty(true);
  };
  const validate = (keys: GroupField[]) => {
    const all = validateGroupFields(fields);
    const selected = Object.fromEntries(
      Object.entries(all.errors).filter(([k]) => keys.includes(k as GroupField)),
    ) as GroupErrors;
    setErrors(selected);
    const first = Object.keys(selected)[0];
    if (first) document.getElementById(`group-${first}`)?.focus();
    return { all, valid: !first };
  };
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (step < 3) {
      if (validate(fieldsByStep[step]!).valid) setStep(step + 1);
      return;
    }
    const { all } = validate(Object.keys(fields) as GroupField[]);
    if (!all.data) {
      const key = Object.keys(all.errors)[0] as GroupField;
      setStep(
        Math.max(
          0,
          fieldsByStep.findIndex((list) => list.includes(key)),
        ),
      );
      return;
    }
    if (state.status !== 'ready') {
      setError(
        t('Configuration is unavailable; save was not performed.', '配置不可用，没有执行保存。'),
      );
      return;
    }
    setBusy(true);
    try {
      const saved = await locked(storageKey, () =>
        saveDraft(localStorage, storageKey, all.data!, baseDraft),
      );
      setDirty(false);
      navigate(`/app/group-drafts/${saved.id}`);
    } catch (e) {
      setError(message(e, t));
    } finally {
      setBusy(false);
    }
  }
  const field = (key: GroupField, label: string, type = 'text', hint?: string) => (
    <div className="group-field" key={key}>
      <label htmlFor={`group-${key}`}>{label}</label>
      {key === 'description' ? (
        <textarea
          id={`group-${key}`}
          value={fields[key]}
          onChange={(e) => update(key, e.target.value)}
          maxLength={2000}
          rows={4}
          aria-describedby={`hint-${key} error-${key}`}
          aria-invalid={!!errors[key]}
        />
      ) : (
        <input
          id={`group-${key}`}
          type={type}
          value={fields[key]}
          onChange={(e) => update(key, e.target.value)}
          maxLength={key === 'title' ? 80 : key === 'beneficiary' ? 42 : 120}
          inputMode={['amount', 'minimum', 'capacity'].includes(key) ? 'decimal' : undefined}
          autoComplete="off"
          spellCheck={false}
          aria-describedby={`hint-${key} error-${key}`}
          aria-invalid={!!errors[key]}
        />
      )}
      <small id={`hint-${key}`}>{hint}</small>
      <span id={`error-${key}`} className="group-error">
        {errors[key]?.[locale]}
      </span>
    </div>
  );
  const preview = validateGroupFields(fields).data;
  return (
    <div className="container group-page">
      <Link
        className="back-link"
        to="/app/group-drafts"
        onClick={(e) => {
          if (dirty && !window.confirm(t('Discard unsaved edits?', '放弃尚未保存的修改？')))
            e.preventDefault();
        }}
      >
        {t('Group drafts', '成团草稿')}
      </Link>
      <div className="page-heading">
        <div>
          <h1>{t('Plan a group collection', '创建成团收款草稿')}</h1>
          <p>
            {t(
              'Agree on the amount, deadline and exit before anyone pays.',
              '先明确金额、期限与退出规则，再让参与者付款。',
            )}
          </p>
        </div>
        <span className="status-label">{t('Draft only · No payments', '仅草稿 · 不收款')}</span>
      </div>
      <ol className="group-steps" aria-label={t('Creation steps', '创建步骤')}>
        {steps.map(([en, zh], i) => (
          <li key={en} aria-current={i === step ? 'step' : undefined}>
            <span>{i + 1}</span>
            {t(en, zh)}
          </li>
        ))}
      </ol>
      <div className="group-layout">
        <form className="group-form" onSubmit={(e) => void submit(e)} noValidate>
          <h2>{t(steps[step]![0], steps[step]![1])}</h2>
          {step === 0 ? (
            <>
              {field('title', t('Group title', '活动标题'))}
              {field(
                'description',
                t('Description (optional)', '活动说明（可选）'),
                'text',
                t(
                  'Do not include private or sensitive information. These terms may later be public.',
                  '不要填写私密或敏感信息，这些规则发布后可能公开。',
                ),
              )}
            </>
          ) : null}
          {step === 1 ? (
            <>
              <p className="small muted">
                {t(
                  'Candidate asset: test AUSD · 6 decimal places. No dollar deposits.',
                  '候选资产：测试 AUSD · 6 位小数。不是美元充值。',
                )}
              </p>
              {field('amount', t('Amount per participant', '每人金额'))}
              <div className="group-field-pair">
                {field('minimum', t('Minimum participants', '最低成团人数'))}
                {field('capacity', t('Maximum participants', '参与人数上限'))}
              </div>
              <p className="small muted">
                {t('Times use your browser timezone: ', '时间使用浏览器所在时区：')}
                {Intl.DateTimeFormat().resolvedOptions().timeZone}
              </p>
              {field('startsAt', t('Collection starts', '募集开始时间'), 'datetime-local')}
              {field('fundingDeadline', t('Collection deadline', '募集截止时间'), 'datetime-local')}
              {field('settleNotBefore', t('Earliest settlement', '最早结算时间'), 'datetime-local')}
            </>
          ) : null}
          {step === 2 ? (
            <>
              {field(
                'beneficiary',
                t('Beneficiary wallet address', '收款钱包地址'),
                'text',
                t(
                  'Fixed single beneficiary. Group splitting comes in a later stage.',
                  '固定单个收款人，合伙分账将在后续阶段接入。',
                ),
              )}
              <p>
                {t(
                  'This is a draft address, not a request for wallet access. Recheck it before publishing.',
                  '这里只记录草稿地址，不请求钱包权限；发布前必须重新核对。',
                )}
              </p>
            </>
          ) : null}
          {step === 3 && preview ? <GroupSummary data={preview} /> : null}
          {step === 3 && !preview ? (
            <p role="alert">
              {t(
                'Some fields or times need updating. Saving will return you to the first invalid step.',
                '部分字段或时间需要更新，保存时将返回首个需要修改的步骤。',
              )}
            </p>
          ) : null}
          {error ? (
            <p className="group-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="group-actions">
            {step > 0 ? (
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => setStep(step - 1)}
              >
                {t('Back', '上一步')}
              </button>
            ) : null}
            <button
              type="submit"
              className="button primary"
              disabled={busy || state.status !== 'ready'}
            >
              {busy
                ? t('Saving…', '正在保存…')
                : step === 3
                  ? t('Save draft', '保存草稿')
                  : t('Continue', '下一步')}
              <Arrow />
            </button>
          </div>
          {step === 3 && preview ? (
            <button
              type="button"
              className="button secondary"
              onClick={() => download(preview, 'unsaved')}
            >
              {t('Export without saving', '不保存，直接导出')}
            </button>
          ) : null}
          <p className="small muted">
            {t(
              'Manual save, on this browser only. Unsaved edits are lost when you leave. No cloud account, wallet signature or payment link is created.',
              '手动保存，仅保存在当前浏览器。离开前未保存的内容会丢失，不创建云账户、不请求签名，也不生成收款链接。',
            )}
          </p>
        </form>
        <aside className="rule-panel group-sidebar">
          <h2>{t('The rules stay visible', '规则始终可见')}</h2>
          <GroupRules />
          <p className="small muted">
            {t(
              'Participants are wallet addresses, not verified people. Network fees remain separate.',
              '参与人数按钱包地址计算，不代表已验证的自然人数；网络费用另计。',
            )}
          </p>
        </aside>
      </div>
    </div>
  );
}
function DraftMissing() {
  const { t } = useApp();
  return (
    <div className="container group-page">
      <h1>{t('Draft not found in this browser', '此浏览器中没有这份草稿')}</h1>
      <p>
        {t(
          'Draft URLs are not public payment links. Use a JSON export to move a draft to another browser.',
          '草稿地址不是公开收款链接。需要跨浏览器使用时，请导出 JSON 草稿。',
        )}
      </p>
      <Link className="button secondary" to="/app/group-drafts">
        {t('Back to drafts', '返回草稿')}
      </Link>
    </div>
  );
}
export function GroupDraftPage() {
  const repo = useDrafts();
  const { draftId } = useParams();
  const { t } = useApp();
  if (!repo.loaded) return <p className="container">{t('Loading draft…', '正在读取草稿…')}</p>;
  if (repo.error)
    return (
      <p className="container group-error" role="alert">
        {repo.error}
      </p>
    );
  const row = repo.rows.find((r) => r.id === draftId);
  if (!row) return <DraftMissing />;
  return (
    <div className="container group-page">
      <Link className="back-link" to="/app/group-drafts">
        {t('All drafts', '全部草稿')}
      </Link>
      <div className="page-heading">
        <div>
          <h1>{t('Draft preview', '草稿预览')}</h1>
          <p>
            {t(
              'Saved on this browser. Not published or payable.',
              '已保存在此浏览器，尚未发布，也不能付款。',
            )}
          </p>
        </div>
        <span className="status-label">
          {t('Draft revision', '草稿版本')} {row.revision}
        </span>
      </div>
      <div className="group-layout">
        <section className="group-form">
          <GroupSummary data={row.data} />
          {row.data.startsAt <= Date.now() / 1000 ? (
            <p className="notice">
              {t(
                'The start time has passed. Edit the dates before this could be published.',
                '开始时间已过，请在发布前修改时间。',
              )}
            </p>
          ) : null}
          <div className="group-actions">
            <Link className="button secondary" to={`/app/group-drafts/${row.id}/edit`}>
              {t('Edit draft', '编辑草稿')}
            </Link>
            <button className="button secondary" onClick={() => download(row.data, row.id)}>
              {t('Export JSON', '导出 JSON')}
            </button>
          </div>
          <button className="button primary" disabled>
            {t('On-chain publishing not enabled', '尚未启用链上发布')}
          </button>
          <p className="small muted">
            {t(
              'This is not a shared order. Wallet publishing and the public collection page are the next development batch.',
              '这还不是共享订单；钱包发布和公开收款页将在下一批开发。',
            )}
          </p>
        </section>
        <aside className="rule-panel group-sidebar">
          <h2>{t('Exit and settlement', '退出与结算')}</h2>
          <GroupRules />
        </aside>
      </div>
    </div>
  );
}
export function GroupDraftListPage() {
  const { t } = useApp();
  const repo = useDrafts();
  const navigate = useNavigate();
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function importFile(file: File | undefined) {
    if (!file || !repo.key) return;
    setBusy(true);
    setError('');
    try {
      if (file.size > 16000) throw new DraftError('INVALID_IMPORT');
      const data = importDraft(await file.text());
      const row = await locked(repo.key, () => saveDraft(localStorage, repo.key!, data));
      navigate(`/app/group-drafts/${row.id}`);
    } catch (e) {
      setError(message(e, t));
    } finally {
      setBusy(false);
    }
  }
  async function remove(row: GroupDraft) {
    if (
      !repo.key ||
      !window.confirm(
        t('Delete this local draft? It has no payments.', '删除此本地草稿？草稿没有收款。'),
      )
    )
      return;
    setBusy(true);
    setError('');
    try {
      await locked(repo.key, () => deleteDraft(localStorage, repo.key!, row));
      repo.refresh();
    } catch (e) {
      setError(message(e, t));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="container group-page">
      <Link className="back-link" to="/app">
        {t('My boxes', '我的 Box')}
      </Link>
      <div className="page-heading">
        <div>
          <h1>{t('Group drafts', '成团草稿')}</h1>
          <p>
            {t(
              'Saved locally, not on chain or in a cloud account.',
              '仅保存在本地，未上链，也未同步至云账户。',
            )}
          </p>
        </div>
        <Link className="button primary" to="/create/group">
          {t('New group draft', '新建成团草稿')}
          <Arrow />
        </Link>
      </div>
      <p className="notice">
        {t(
          'Only this browser and environment can read these drafts. Clearing site data deletes them. Anyone using this browser profile may see them; export a backup when needed.',
          '仅当前浏览器和环境可读取这些草稿。清除网站数据会删除草稿，使用同一浏览器配置的人可能看到内容；需要时请导出备份。',
        )}
      </p>
      <div className="group-actions">
        <label className="group-import">
          {t('Import draft JSON', '导入 JSON 草稿')}
          <input
            type="file"
            accept="application/json,.json"
            aria-label={t('Import draft JSON', '导入 JSON 草稿')}
            disabled={busy || !repo.key || !!repo.error}
            onChange={(e) => {
              void importFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
        <button className="button secondary" onClick={repo.refresh} disabled={busy || !repo.key}>
          {t('Refresh drafts', '刷新草稿')}
        </button>
      </div>
      {repo.error || error ? (
        <p className="group-error" role="alert">
          {repo.error || error}
        </p>
      ) : null}
      {!repo.loaded ? (
        <p>{t('Waiting for configuration…', '等待配置加载…')}</p>
      ) : !repo.rows.length && !repo.error ? (
        <div className="empty-state">
          <h2>{t('No saved group drafts', '尚无成团草稿')}</h2>
          <p>
            {t(
              'Start with an amount and a deadline. No wallet needed for drafting.',
              '先确定金额与截止时间，填写草稿无需连接钱包。',
            )}
          </p>
        </div>
      ) : null}
      <ul className="group-draft-list">
        {repo.rows.map((row) => (
          <li key={row.id}>
            <div>
              <span className="status-label">
                {t('Local draft', '本地草稿')} · {row.revision}
              </span>
              <h2>
                <Link to={`/app/group-drafts/${row.id}`}>{row.data.title}</Link>
              </h2>
              <p>
                {formatAmount(BigInt(row.data.unitPrice), 6)}{' '}
                {t('test AUSD per wallet', '测试 AUSD / 钱包')} · {row.data.minimum}/
                {row.data.capacity}
              </p>
            </div>
            <div className="group-actions">
              <Link className="button secondary" to={`/app/group-drafts/${row.id}`}>
                {t('Preview', '预览')}
              </Link>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => download(row.data, row.id)}
              >
                {t('Export', '导出')}
              </button>
              <button className="group-delete" disabled={busy} onClick={() => void remove(row)}>
                {t('Delete', '删除')}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
