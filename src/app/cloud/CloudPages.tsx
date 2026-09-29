import { errorText, useSession, Login, Header } from '../shared/Session';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatUnits } from 'viem';
import { GroupOverview } from '../group/GroupOverview';
import type { ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useApp } from '../context';
import { GroupRules } from '../group/GroupPages';
import { CloudSummary as GroupSummary } from './CloudSummary';
import { discoverWallets, walletState } from '../../shared/wallet';
import type { WalletOption } from '../../shared/wallet';
import {
  draftKey,
  readDrafts,
  importDraft,
  exportDraft,
  fieldsFromData,
  validateGroupFields,
} from '../../shared/group/draft';
import type { GroupData, GroupDraft, GroupFields } from '../../shared/group/draft';
import type { CloudBox, SessionInfo, PublicGroup } from '../../shared/cloud/model';
import { api, ApiError, sendPublication, readJournal, sameAccount } from './api';
import './cloud.css';
import { GroupFunds } from '../group/GroupFunds';
function Gate({ children }: { children: ReactNode }) {
  const { state, t } = useApp();
  if (state.status !== 'ready')
    return (
      <section className="container cloud-page">
        <h1>{t('Cloud groups', '云端成团')}</h1>
        <p role="status">{t('Waiting for configuration…', '等待配置…')}</p>
      </section>
    );
  if (!state.config.capabilities.cloudGroups)
    return (
      <section className="container cloud-page">
        <h1>{t('Cloud groups', '云端成团')}</h1>
        <div className="notice">
          <p>
            {t(
              'Cloud features are ready for configuration, but the isolated D1 database has not been enabled on this environment. No cloud sign-in or publishing is available yet.',
              '云端功能代码已准备，本环境尚未启用隔离的 D1 数据库，暂不提供云端登录和发布。',
            )}
          </p>
        </div>
        <Link className="button primary" to="/app/group-drafts">
          {t('Use local drafts', '继续使用本地草稿')}
        </Link>
      </section>
    );
  return children;
}
export function CloudGroupsPage() {
  return (
    <Gate>
      <CloudGroups />
    </Gate>
  );
}
function CloudGroups() {
  const { session, setSession, loading } = useSession();
  const { t, state } = useApp();
  const [params] = useSearchParams();
  const [rows, setRows] = useState<CloudBox[]>([]),
    [local, setLocal] = useState<GroupDraft[]>([]),
    [selection, setSelection] = useState(params.get('draft') ?? ''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [upload, setUpload] = useState<GroupData | null>(null);
  const idempotency = useRef<{ payload: string; key: string } | null>(null);
  const refresh = () => api<CloudBox[]>('/groups').then(setRows);
  useEffect(() => {
    if (!session) return;
    let active = true;
    void api<CloudBox[]>('/groups')
      .then((r) => {
        if (active) setRows(r);
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [session]);
  useEffect(() => {
    if (state.status === 'ready')
      try {
        setLocal(readDrafts(localStorage, draftKey(state.config.environment)));
      } catch (e) {
        setError(errorText(e));
      }
  }, [state]);
  async function save() {
    if (!session) return;
    setBusy(true);
    setError('');
    try {
      const data = upload ?? local.find((d) => d.id === selection)?.data;
      if (!data) throw Error('Choose a local draft or import JSON / 请选择草稿或导入 JSON');
      const payload = JSON.stringify(data);
      if (idempotency.current?.payload !== payload)
        idempotency.current = { payload, key: crypto.randomUUID() };
      await api('/groups', 'POST', { data }, session.csrf, idempotency.current.key);
      await refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="container cloud-page">
      <h1>{t('Cloud groups', '云端成团')}</h1>
      {loading ? (
        <p role="status">{t('Loading session…', '正在读取登录状态…')}</p>
      ) : !session ? (
        <Login onLogin={setSession} />
      ) : (
        <>
          <Header
            session={session}
            onLogout={() => {
              setSession(null);
              setRows([]);
            }}
          />
          <div className="cloud-card">
            <h2>{t('Save a local draft to your account', '将本地草稿保存到账号')}</h2>
            <p>
              {t(
                'This copies the draft; it does not publish on chain. Local drafts are not deleted.',
                '此操作复制草稿到云端，不会链上发布，本地原稿不会删除。',
              )}
            </p>
            <label>
              {t('Local draft', '本地草稿')}
              <select
                value={selection}
                onChange={(e) => {
                  setSelection(e.target.value);
                  setUpload(null);
                }}
              >
                <option value="">{t('Choose a draft', '请选择草稿')}</option>
                {local.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.data.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('Import Group JSON', '导入成团 JSON')}
              <input
                type="file"
                accept=".json,application/json"
                onChange={(e) => {
                  setUpload(null);
                  setSelection('');
                  const f = e.target.files?.[0];
                  if (!f) return;
                  if (f.size > 16000) {
                    setError('JSON exceeds 16 KB / 文件超过 16 KB');
                    return;
                  }
                  void f
                    .text()
                    .then((raw) => {
                      setUpload(importDraft(raw));
                      setError('');
                    })
                    .catch((e) => setError(errorText(e)));
                }}
              />
            </label>
            {upload ? <p>{upload.title}</p> : null}
            <button
              className="button primary"
              disabled={busy || (!upload && !selection)}
              onClick={() => void save()}
            >
              {t('Save to cloud', '保存到云端')}
            </button>
            <Link className="button secondary" to="/create/group">
              {t('Create a local draft', '新建本地草稿')}
            </Link>
          </div>
          <h2>{t('Your cloud records', '你的云端记录')}</h2>
          {!rows.length ? (
            <p>{t('No cloud groups saved yet.', '尚无云端成团记录。')}</p>
          ) : (
            <ul className="cloud-list">
              {rows.map((b) => (
                <li key={b.id}>
                  <Link to={`/app/groups/${b.id}`}>
                    <strong>{b.data.title}</strong>
                    <span>
                      {b.state} · {t('Revision', '版本')} {b.revision}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
export function CloudGroupPage() {
  return (
    <Gate>
      <CloudGroup />
    </Gate>
  );
}
function CloudGroup() {
  const { id } = useParams();
  const { t, state } = useApp();
  const { session, setSession, loading } = useSession();
  const [b, setBox] = useState<CloudBox | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [hash, setHash] = useState(''),
    [notice, setNotice] = useState('');
  const [wallets, setWallets] = useState<WalletOption[]>([]),
    [selected, setSelected] = useState(''),
    [ack, setAck] = useState(false),
    [editing, setEditing] = useState(false);
  const wallet = wallets.find((w) => w.id === selected) ?? wallets[0];
  useEffect(() => discoverWallets(window, setWallets), []);
  useEffect(() => {
    if (!session || !id) return;
    let active = true;
    setBox(null);
    void api<CloudBox>(`/groups/${id}`)
      .then((v) => {
        if (active) {
          setBox(v);
          if (v.publication) {
            try {
              setHash(v.publication.hash ?? readJournal(v.publication.intent)?.hash ?? '');
            } catch (e) {
              setError(errorText(e));
            }
          }
        }
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [id, session]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function prepare() {
    if (!b || !session) return;
    setBox(
      await api<CloudBox>(
        `/groups/${b.id}/prepare`,
        'POST',
        { revision: b.revision },
        session.csrf,
      ),
    );
  }
  async function recheck(supplied = hash) {
    if (!b || !session) return;
    const next = await api<CloudBox>(
      `/groups/${b.id}/confirm`,
      'POST',
      supplied ? { hash: supplied } : {},
      session.csrf,
    );
    setBox(next);
    if (next.publication?.hash) setHash(next.publication.hash);
  }
  async function send() {
    if (!b?.publication || !session || !wallet) return;
    const account = (await walletState(wallet.provider, true)).account;
    if (!account || !sameAccount(account, session.address))
      throw Error('Select the signed-in wallet account / 请使用当前登录的钱包账号');
    const tx = await sendPublication(
      wallet.provider,
      b.publication.intent,
      state.status === 'ready' ? state.config.environment : 'unavailable',
    );
    setHash(tx);
    setNotice(
      t(
        'Transaction sent. Recheck until finalized; do not send again.',
        '交易已发送，请核验至最终确认，不要重复发送。',
      ),
    );
    await recheck(tx);
  }
  return (
    <section className="container cloud-page">
      <Link to="/app/groups">{t('All cloud groups', '全部云端成团')}</Link>
      <h1>{t('Manage group publication', '管理成团发布')}</h1>
      {loading ? (
        <p>{t('Loading session…', '正在读取会话…')}</p>
      ) : !session ? (
        <Login onLogin={setSession} />
      ) : (
        <>
          <Header
            session={session}
            onLogout={() => {
              setSession(null);
              setBox(null);
            }}
          />
          {b ? (
            <>
              <div className="cloud-layout">
                <div className="cloud-card">
                  <GroupSummary data={b.data} published={b.state === 'published'} />
                  <p>
                    {t('Cloud revision', '云端版本')} {b.revision} · {b.state}
                  </p>
                  {b.state === 'draft' ? (
                    <>
                      <button
                        className="button secondary"
                        disabled={busy}
                        onClick={() => setEditing(!editing)}
                      >
                        {t('Edit cloud draft', '编辑云端草稿')}
                      </button>
                      <button
                        className="button secondary"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            if (
                              !window.confirm(
                                t(
                                  'Delete this cloud draft? Local copies are kept.',
                                  '删除此云端草稿？本地副本仍保留。',
                                ),
                              )
                            )
                              return;
                            await api(
                              `/groups/${b.id}`,
                              'DELETE',
                              { revision: b.revision },
                              session.csrf,
                            );
                            setBox(null);
                            setNotice(t('Draft deleted.', '草稿已删除。'));
                          })
                        }
                      >
                        {t('Delete cloud draft', '删除云端草稿')}
                      </button>
                    </>
                  ) : null}
                  {editing && b.state === 'draft' ? (
                    <CloudEditor
                      box={b}
                      session={session}
                      onSave={(v) => {
                        setBox(v);
                        setEditing(false);
                      }}
                    />
                  ) : null}
                  <details>
                    <summary>{t('Export rules as JSON', '导出规则 JSON')}</summary>
                    <textarea
                      readOnly
                      aria-label={t('Exported draft JSON', '导出的草稿 JSON')}
                      value={exportDraft(b.data)}
                      rows={6}
                    />
                  </details>
                </div>
                <div className="cloud-card">
                  <h2>{t('Publish on Monad Testnet', '发布到 Monad 测试网')}</h2>
                  <p>
                    {t(
                      'Publishing freezes these rules and creates a group. Payments require a separate wallet confirmation on the verified public page.',
                      '发布将冻结规则并创建成团。付款需要在已核验的公开页面另行确认钱包操作。',
                    )}
                  </p>
                  <GroupRules />
                  {!b.publication ? (
                    <button
                      className="button primary"
                      disabled={
                        busy ||
                        state.status !== 'ready' ||
                        !state.config.capabilities.groupPublishing
                      }
                      onClick={() => void run(prepare)}
                    >
                      {t('Prepare publication', '准备发布')}
                    </button>
                  ) : (
                    <>
                      <p>
                        {t('Publication status', '发布状态')}：
                        <strong>{b.publication.state}</strong>
                      </p>
                      <p>
                        {t('Fixed contract', '固定合约')}：
                        <code>{b.publication.intent.deployment.address}</code>
                      </p>
                      <p>
                        Box ID：<code>{b.publication.intent.chainBoxId}</code>
                      </p>
                      <p>
                        {t('Signing deadline', '签名期限')}：
                        {new Date(b.publication.intent.expiresAt * 1000).toISOString()}
                      </p>
                      <p className="small">
                        {t(
                          'Frozen records cannot be edited or reused with a new nonce. Export and clone a draft when terms or times need changing; resolve any earlier transaction first.',
                          '冻结记录不能修改或替换交易序号。需要调整时间或规则时导出并复制草稿；先核实旧交易。',
                        )}
                      </p>
                      {b.state !== 'published' ? (
                        <>
                          <label>
                            {t('Signing wallet', '签名钱包')}
                            <select
                              value={wallet?.id ?? ''}
                              onChange={(e) => setSelected(e.target.value)}
                            >
                              {wallets.map((w) => (
                                <option key={w.id} value={w.id}>
                                  {w.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="cloud-check">
                            <input
                              type="checkbox"
                              checked={ack}
                              onChange={(e) => setAck(e.target.checked)}
                            />
                            {t(
                              'I reviewed the addresses, immutable rules and testnet-only transaction.',
                              '我已核对地址、不可变规则与仅测试网交易。',
                            )}
                          </label>
                          <button
                            className="button primary"
                            disabled={busy || !ack || !wallet || b.publication.state !== 'prepared'}
                            onClick={() => void run(send)}
                          >
                            {t('Sign publication', '签名发布')}
                          </button>
                        </>
                      ) : (
                        <Link className="button primary" to={`/b/${b.publicId}`}>
                          {t('Open public page', '打开公开页面')}
                        </Link>
                      )}
                      <label>
                        {t(
                          'Transaction hash (optional for recovery)',
                          '交易哈希（可选，用于恢复）',
                        )}
                        <input
                          value={hash}
                          onChange={(e) => setHash(e.target.value)}
                          autoComplete="off"
                          spellCheck={false}
                        />
                      </label>
                      <button
                        className="button secondary"
                        disabled={busy}
                        onClick={() => void run(() => recheck())}
                      >
                        {t('Recheck on chain', '重新查链核验')}
                      </button>
                    </>
                  )}
                  {state.status === 'ready' && !state.config.capabilities.groupPublishing ? (
                    <p>
                      {t(
                        'No verified contract is registered for this environment yet. Your cloud draft can still be edited.',
                        '本环境尚未登记已验证合约，发布不可用，仍可编辑云端草稿。',
                      )}
                    </p>
                  ) : null}
                </div>
              </div>
            </>
          ) : null}
        </>
      )}
      {busy ? (
        <p role="status">
          {t('Working… do not submit another request.', '处理中，请勿重复提交。')}
        </p>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
function CloudEditor({
  box,
  session,
  onSave,
}: {
  box: CloudBox;
  session: SessionInfo;
  onSave: (b: CloudBox) => void;
}) {
  const { t } = useApp();
  const [fields, setFields] = useState(() => fieldsFromData(box.data)),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const labels: Record<keyof GroupFields, [string, string]> = {
    title: ['Title', '标题'],
    description: ['Description', '说明'],
    amount: ['Amount per person', '每人金额'],
    minimum: ['Minimum participants', '成团人数'],
    capacity: ['Capacity', '人数上限'],
    beneficiary: ['Beneficiary', '收款地址'],
    startsAt: ['Start time', '开始时间'],
    fundingDeadline: ['Deadline', '募集截止'],
    settleNotBefore: ['Settlement time', '结算时间'],
  };
  return (
    <form
      className="cloud-editor"
      onSubmit={(e) => {
        e.preventDefault();
        const valid = validateGroupFields(fields);
        if (!valid.data) {
          setError(t('Check all values and use future times.', '请核对全部字段，并使用未来时间。'));
          return;
        }
        setBusy(true);
        setError('');
        void api<CloudBox>(
          `/groups/${box.id}`,
          'PATCH',
          { data: valid.data, revision: box.revision },
          session.csrf,
        )
          .then(onSave)
          .catch((e) => setError(errorText(e)))
          .finally(() => setBusy(false));
      }}
    >
      {(Object.keys(labels) as (keyof GroupFields)[]).map((key) => (
        <label key={key}>
          {t(...labels[key])}
          <input
            value={fields[key]}
            type={
              ['startsAt', 'fundingDeadline', 'settleNotBefore'].includes(key)
                ? 'datetime-local'
                : 'text'
            }
            onChange={(e) => setFields((f) => ({ ...f, [key]: e.target.value }))}
          />
        </label>
      ))}
      <button className="button primary" disabled={busy}>
        {t('Save cloud changes', '保存云端修改')}
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}
export function PublicGroupPage() {
  const { id } = useParams(),
    { t } = useApp();
  const [value, setValue] = useState<PublicGroup | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [attempt, setAttempt] = useState(0);
  const updateSnapshot = useCallback((snapshot: PublicGroup['snapshot']) => {
    setValue((current) => (current ? { ...current, snapshot } : current));
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setValue(null);
    setError('');
    void api<PublicGroup>(`/public/groups/${id}`)
      .then((v) => {
        if (active) setValue(v);
      })
      .catch((e) => {
        if (active)
          setError(e instanceof ApiError && e.status === 404 ? 'NOT_PUBLISHED' : errorText(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id, attempt]);
  const names: Record<string, [string, string]> = {
    UPCOMING: ['Not started', '尚未开始'],
    OPEN: ['Collecting', '募集期间'],
    FULL: ['Capacity reached', '人数已满'],
    READY: ['Target met · awaiting settlement', '已成团 · 等待结算'],
    REFUNDABLE: ['Target missed · refundable', '未成团 · 可退款'],
    CANCELLED: ['Cancelled', '已取消'],
    SETTLED: ['Settled', '已结算'],
  };
  return (
    <section className="container cloud-page public-group-page">
      <p className="eyebrow">Group · Monad Testnet</p>
      <h1>
        <span className="group-page-title">{t('Group collection', '成团收款')}</span>
        <span className="group-checkout-title">{t('Confirm payment', '确认付款')}</span>
      </h1>
      {loading ? (
        <p role="status">
          {t('Verifying published rules and chain state…', '正在核验公开规则与链状态…')}
        </p>
      ) : value ? (
        <div className="public-box-layout">
          <div>
            <span className="status-label">
              {t(...(names[value.snapshot.state] ?? ['Unknown', '未知']))}
            </span>
            <GroupOverview group={value} />
            <details className="cloud-card">
              <summary>{t('All fixed rules', '完整固定规则')}</summary>
              <GroupSummary data={value.data} published />
              <GroupRules />
            </details>
          </div>
          <aside className="public-checkout">
            <div className="cloud-card public-amount-card">
              <h2>{t('Participation amount', '每次参与金额')}</h2>
              <p className="group-payment-title">{value.data.title}</p>
              <div className="payment-amount">
                {formatUnits(BigInt(value.data.unitPrice), 18)} <small>MON</small>
              </div>
              <p>
                {t(
                  'Monad Testnet · network fee paid separately in MON',
                  'Monad 测试网 · 网络费另以 MON 支付',
                )}
              </p>
            </div>
            {!value.paymentsEnabled ? (
              <button className="button primary" disabled>
                {t('Payments are not enabled yet', '付款功能尚未开放')}
              </button>
            ) : null}
            <GroupFunds key={value.publicId} group={value} onSnapshot={updateSnapshot} />
            <button className="button secondary" onClick={() => setAttempt((x) => x + 1)}>
              {t('Refresh chain state', '刷新链状态')}
            </button>
            <button
              className="button secondary"
              onClick={() =>
                void navigator.clipboard
                  .writeText(location.href)
                  .catch(() =>
                    setError(
                      t('Copy the address from your browser.', '请从浏览器地址栏复制链接。'),
                    ),
                  )
              }
            >
              {t('Copy share link', '复制分享链接')}
            </button>
            <details>
              <summary>{t('Verification details', '核验详情')}</summary>
              <p>
                {t('Confirmed block', '确认区块')}：{value.snapshot.blockNumber}
              </p>
              <p>
                {t('Creator', '创建者')}：<code>{value.creator}</code>
              </p>
              <p>
                Contract: <code>{value.module}</code>
              </p>
              <p>
                Box ID: <code>{value.chainBoxId}</code>
              </p>
              <p>
                Transaction: <code>{value.transactionHash}</code>
              </p>
              <p>
                Metadata: <code>{value.metadataHash}</code>
              </p>
              <p>
                Terms: <code>{value.termsHash}</code>
              </p>
            </details>
          </aside>
        </div>
      ) : (
        <div className="cloud-card">
          <h2>
            {error === 'NOT_PUBLISHED'
              ? t('Not found or not published', '记录不存在或尚未发布')
              : t('Unable to verify this group', '暂时无法核验此成团')}
          </h2>
          <p>
            {error === 'NOT_PUBLISHED'
              ? t(
                  'Drafts and pending publications are private. This link cannot accept payments.',
                  '草稿和待确认的发布不公开，此链接不能收款。',
                )
              : error}
          </p>
          <button className="button secondary" onClick={() => setAttempt((x) => x + 1)}>
            {t('Retry', '重试')}
          </button>
        </div>
      )}
    </section>
  );
}
