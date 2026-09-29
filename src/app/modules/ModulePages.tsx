import { getTool } from '../../shared/tools';
import { ToolIcon } from '../components';
import { PrivateFiles } from './PrivateFiles';
import { statusLabel } from '../shared/status';
import { useCallback, useEffect, useState } from 'react';
import { PublicOverview, PublicAmount } from './PublicOverview';
import type { ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { Hex } from 'viem';
import { useApp } from '../context';
import { api } from '../cloud/api';
import { Login, Header, useSession, errorText } from '../shared/Session';
import type { SessionInfo } from '../../shared/cloud/model';
import type { ModuleBox, ModuleData, ModulePublication } from '../../shared/modules/model';
import type { ModuleSnapshot } from '../../shared/modules/chain';
import { validatePublication } from '../../shared/modules/terms';
import { ModuleEditor, ModuleRules } from './ModuleEditor';
import { ModuleFunds } from './ModuleFunds';
import { draftKey, readDrafts, saveDraft, deleteDraft, importModule, exportModule } from './drafts';
import type { ModuleDraft } from './drafts';
import '../cloud/cloud.css';
import './modules.css';
export function ModuleBuilderPage({ kind }: { kind?: ModuleData['tool'] }) {
  const { state, t } = useApp(),
    { id, draftId } = useParams();
  if (state.status !== 'ready')
    return <p className="container">{t('Loading configuration…', '加载配置…')}</p>;
  if (
    !draftId &&
    !kind &&
    !['split', 'group-split', 'deliver', 'attend', 'milestones', 'rewards'].includes(id ?? '')
  )
    return (
      <section className="container cloud-page">
        <h1>{t('This tool is being prepared', '工具开发中')}</h1>
        <Link to="/">{t('All tools', '全部工具')}</Link>
      </section>
    );
  return (
    <Builder
      key={`${state.config.environment}:${draftId ?? kind ?? id}`}
      environment={state.config.environment}
      tool={
        kind ??
        (id === 'group-split'
          ? 'group'
          : id === 'deliver'
            ? 'deliver'
            : id === 'milestones'
              ? 'milestones'
              : id === 'rewards'
                ? 'rewards'
                : id === 'attend'
                  ? 'attend'
                  : 'split')
      }
      draftId={draftId}
      cloudEnabled={
        state.config.capabilities.cloudModules && state.config.capabilities.modulePublishing
      }
    />
  );
}
function Builder({
  environment,
  tool,
  draftId,
  cloudEnabled,
}: {
  environment: string;
  tool: ModuleData['tool'];
  draftId?: string | undefined;
  cloudEnabled: boolean;
}) {
  const { t } = useApp(),
    navigate = useNavigate(),
    key = draftKey(environment);
  const [draft, setDraft] = useState<ModuleDraft | undefined>(),
    [loaded, setLoaded] = useState(!draftId),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!draftId) return;
    try {
      const found = readDrafts(key).find((r) => r.id === draftId);
      if (!found) throw Error('Local draft not found in this browser / 当前浏览器未找到该草稿');
      setDraft(found);
      setLoaded(true);
    } catch (e) {
      setError(errorText(e));
    }
  }, [key, draftId]);
  return (
    <section className="container cloud-page">
      <div className="editor-title">
        <span className="tool-icon">
          <ToolIcon id={draft?.data.tool ?? tool} />
        </span>
        <div>
          <h1>
            {t('Create ', '创建')}
            {t(
              getTool(draft?.data.tool ?? tool)!.name + ' Box',
              getTool(draft?.data.tool ?? tool)!.label.zh,
            )}
          </h1>
          <p>{t(getTool(tool)!.description.en, getTool(tool)!.description.zh)}</p>
        </div>
      </div>

      <p className="creation-nav">
        <Link to="/app/module-drafts">{t('My local drafts', '我的本地草稿')}</Link> ·{' '}
        <Link to="/app/modules">{t('Cloud boxes', '云端 Box')}</Link>
      </p>
      {error ? <p role="alert">{error}</p> : null}
      {loaded ? (
        <ModuleEditor
          key={draft?.id ?? 'new'}
          tool={draft?.data.tool ?? tool}
          initial={draft?.data}
          busy={busy}
          continueToPublish={cloudEnabled && tool === 'split'}
          onSave={(data) => {
            setBusy(true);
            setError('');
            void saveDraft(key, data, draft)
              .then((row) => {
                setDraft(row);
                setSaved(true);
                if (cloudEnabled && data.tool === 'split')
                  navigate('/app/modules?draft=' + encodeURIComponent(row.id));
                else if (!draftId) navigate('/app/module-drafts/' + row.id, { replace: true });
              })
              .catch((e) => setError(errorText(e)))
              .finally(() => setBusy(false));
          }}
        />
      ) : null}
      {saved ? <p role="status">{t('Saved in this browser.', '已保存在当前浏览器。')}</p> : null}
      {draft ? (
        <details className="cloud-card">
          <summary>{t('Export this local draft', '导出本地草稿')}</summary>
          <textarea readOnly rows={8} value={exportModule(draft.data)} />
        </details>
      ) : null}
    </section>
  );
}
export function ModuleDraftsPage() {
  const { state, t } = useApp(),
    navigate = useNavigate(),
    [rows, setRows] = useState<ModuleDraft[]>([]),
    [raw, setRaw] = useState(''),
    [error, setError] = useState('');
  const [remove, setRemove] = useState<ModuleDraft | null>(null),
    [busy, setBusy] = useState(false);
  const key = state.status === 'ready' ? draftKey(state.config.environment) : null;
  useEffect(() => {
    if (key)
      try {
        setRows(readDrafts(key));
      } catch (e) {
        setError(errorText(e));
      }
  }, [key]);
  return (
    <section className="container cloud-page">
      <h1>{t('Local payment drafts', '本地付款草稿')}</h1>
      <p>
        {t(
          'These rules exist only in this browser. Export before clearing site data.',
          '这些规则仅存于当前浏览器，清理网站数据前请先导出。',
        )}
      </p>
      <p>
        <Link to="/create/split">{t('New Split', '新建分账')}</Link> ·{' '}
        <Link to="/create/group-split">{t('New group with split', '新建成团分账')}</Link> ·{' '}
        <Link to="/create/deliver">{t('New delivery escrow', '新建交付托管')}</Link> ·{' '}
        <Link to="/create/attend">{t('New attendance bond', '新建报名押金')}</Link> ·{' '}
        <Link to="/create/milestones">{t('New milestone escrow', '新建分阶段托管')}</Link> ·{' '}
        <Link to="/create/rewards">{t('New rewards', '新建奖励')}</Link> ·{' '}
        <Link to="/app/modules">{t('Copy a draft to cloud', '复制草稿到云端')}</Link>
      </p>
      {error ? <p role="alert">{error}</p> : null}
      <ul className="cloud-list">
        {rows.map((row) => (
          <li key={row.id}>
            <Link to={'/app/module-drafts/' + row.id}>
              {row.data.title}
              <span>
                {row.data.tool} · {t('Local', '本地')} · rev {row.revision}
              </span>
            </Link>
            {state.status === 'ready' && state.config.capabilities.cloudModules ? (
              <Link className="button secondary" to={'/app/modules?draft=' + row.id}>
                {t('Continue to publish', '继续发布')}
              </Link>
            ) : null}
            <button className="button secondary" onClick={() => setRemove(row)}>
              {t('Delete', '删除')}
            </button>
          </li>
        ))}
      </ul>
      {!rows.length ? <p>{t('No local drafts yet.', '暂无本地草稿。')}</p> : null}
      {remove ? (
        <div className="cloud-card">
          <p>
            {t('Delete this local draft?', '删除此本地草稿？')} {remove.data.title}
          </p>
          <button className="button secondary" disabled={busy} onClick={() => setRemove(null)}>
            {t('Keep draft', '保留草稿')}
          </button>
          <button
            className="button secondary"
            disabled={busy || !key}
            onClick={() => {
              if (!key) return;
              setBusy(true);
              void deleteDraft(key, remove)
                .then(() => {
                  setRows(readDrafts(key));
                  setRemove(null);
                })
                .catch((e) => setError(errorText(e)))
                .finally(() => setBusy(false));
            }}
          >
            {t('Confirm delete', '确认删除')}
          </button>
        </div>
      ) : null}
      <div className="cloud-card">
        <label>
          {t('Import an exported draft', '导入已导出的草稿')}
          <textarea rows={6} value={raw} onChange={(e) => setRaw(e.target.value)} />
        </label>
        <button
          className="button secondary"
          disabled={busy || !key}
          onClick={() => {
            if (!key) return;
            setBusy(true);
            setError('');
            void Promise.resolve()
              .then(() => saveDraft(key, importModule(raw)))
              .then((row) => navigate('/app/module-drafts/' + row.id))
              .catch((e) => setError(errorText(e)))
              .finally(() => setBusy(false));
          }}
        >
          {t('Import as a new local draft', '导入为新的本地草稿')}
        </button>
      </div>
    </section>
  );
}
function CloudGate({ children }: { children: ReactNode }) {
  const { state, t } = useApp();
  if (state.status !== 'ready' || !state.config.capabilities.cloudModules)
    return (
      <section className="container cloud-page">
        <h1>{t('Cloud payment tools', '云端付款工具')}</h1>
        <p className="notice">
          {t(
            'Cloud resources and reviewed module deployments must be enabled in this environment before sign-in and publication. Local drafting is available.',
            '本环境需启用云端资源并登记已核验的工具合约后才能登录发布。目前可使用本地草稿。',
          )}
        </p>
        <Link className="button primary" to="/app/module-drafts">
          {t('Open local drafts', '打开本地草稿')}
        </Link>
      </section>
    );
  return children;
}
export function CloudModulesPage() {
  return (
    <CloudGate>
      <CloudModules />
    </CloudGate>
  );
}
function CloudModules() {
  const { state, t } = useApp(),
    { session, setSession, loading } = useSession(),
    [searchParams] = useSearchParams(),
    [rows, setRows] = useState<ModuleBox[]>([]),
    [raw, setRaw] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [local, setLocal] = useState<ModuleDraft[]>([]),
    [localLoaded, setLocalLoaded] = useState(false),
    navigate = useNavigate();
  const selectedId = searchParams.get('draft');
  const selectedDraft = local.find((row) => row.id === selectedId);
  useEffect(() => {
    setRows([]);
    if (session)
      void api<ModuleBox[]>('/modules')
        .then(setRows)
        .catch((e) => setError(errorText(e)));
  }, [session]);
  useEffect(() => {
    if (state.status === 'ready')
      try {
        setLocal(readDrafts(draftKey(state.config.environment)));
      } catch (e) {
        setError(errorText(e));
      } finally {
        setLocalLoaded(true);
      }
  }, [state]);
  function copy(data: ModuleData) {
    if (!session) return;
    setBusy(true);
    setError('');
    void api<ModuleBox>('/modules', 'POST', { data }, session.csrf, crypto.randomUUID())
      .then((b) => navigate('/app/modules/' + b.id))
      .catch((e) => setError(errorText(e)))
      .finally(() => setBusy(false));
  }
  async function copyAndPrepare(draft: ModuleDraft) {
    if (!session || busy || state.status !== 'ready' || !state.config.capabilities.modulePublishing)
      return;
    setBusy(true);
    setError('');
    try {
      const box = await api<ModuleBox>(
        '/modules',
        'POST',
        { data: draft.data },
        session.csrf,
        crypto.randomUUID(),
      );
      try {
        await api<ModuleBox>(
          `/modules/${box.id}/prepare`,
          'POST',
          { revision: box.revision },
          session.csrf,
        );
        navigate('/app/modules/' + box.id);
      } catch (e) {
        navigate('/app/modules/' + box.id, { state: { handoffError: errorText(e) } });
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="container cloud-page">
      <h1>{t('My cloud payment boxes', '我的云端付款 Box')}</h1>
      <p className="creation-nav">
        <Link to="/app/module-drafts">{t('Local drafts', '本地草稿')}</Link> ·{' '}
        <Link to="/app/module-activity">{t('Funds workbench', '资金工作台')}</Link> ·{' '}
        <Link to="/app/groups">{t('Original Group V1', '原版 Group V1')}</Link>
      </p>
      {session ? <Header session={session} onLogout={() => setSession(null)} /> : null}
      {selectedId && localLoaded && !selectedDraft ? (
        <p role="alert">
          {t(
            'This local draft is unavailable in this browser. Open your local drafts to choose one.',
            '当前浏览器找不到这份本地草稿，请从本地草稿列表重新选择。',
          )}{' '}
          <Link to="/app/module-drafts">{t('Local drafts', '本地草稿')}</Link>
        </p>
      ) : null}
      {selectedDraft ? (
        <section className="cloud-card publish-next">
          <h2>
            {t('Next: publish ', '下一步：发布“')}
            {selectedDraft.data.title}
            {t('', '”')}
          </h2>
          <p>
            {t(
              'Review these rules. The button copies them to cloud storage and freezes them for publication. Your wallet will confirm the publication separately; no MON is paid here.',
              '请核对规则。下方按钮会将公开规则复制到云端并冻结；下一页仍需钱包确认发布，此处不会支付 MON。',
            )}
          </p>
          <ModuleRules data={selectedDraft.data} />
          {session ? (
            <button
              className="button primary"
              disabled={
                busy || state.status !== 'ready' || !state.config.capabilities.modulePublishing
              }
              onClick={() => void copyAndPrepare(selectedDraft)}
            >
              {t('Copy rules and prepare publication', '复制规则并准备发布')}
            </button>
          ) : (
            <p>{t('Sign in below to continue.', '请先在下方签名登录，再继续发布。')}</p>
          )}
        </section>
      ) : null}
      {session ? (
        <>
          <ul className="cloud-list">
            {rows.map((b) => (
              <li key={b.id}>
                <Link to={'/app/modules/' + b.id}>
                  {b.data.title}
                  <span>
                    {b.data.tool} · {b.state}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {!selectedDraft ? (
            <div className="cloud-card">
              <h2>{t('Explicitly copy a local draft', '明确复制本地草稿')}</h2>
              <p>
                {t(
                  'Only the selected public rules are uploaded. The local original remains.',
                  '仅上传你选择的公开规则，本地原稿保留。',
                )}
              </p>
              {local.map((d) => (
                <p key={d.id}>
                  {d.data.title}{' '}
                  <button className="button secondary" disabled={busy} onClick={() => copy(d.data)}>
                    {t('Copy to cloud', '复制到云端')}
                  </button>
                </p>
              ))}
              <label>
                {t('Or paste an exported draft', '或粘贴导出的草稿')}
                <textarea rows={5} value={raw} onChange={(e) => setRaw(e.target.value)} />
              </label>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => {
                  try {
                    copy(importModule(raw));
                  } catch (e) {
                    setError(errorText(e));
                  }
                }}
              >
                {t('Copy imported rules to cloud', '复制导入规则到云端')}
              </button>
            </div>
          ) : null}
        </>
      ) : loading ? (
        <p>{t('Checking session…', '核对登录…')}</p>
      ) : (
        <Login onLogin={setSession} />
      )}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
export function CloudModulePage() {
  return (
    <CloudGate>
      <CloudModule />
    </CloudGate>
  );
}
function CloudModule() {
  const { id } = useParams(),
    location = useLocation(),
    { state, t } = useApp(),
    { session, setSession, loading } = useSession(),
    [box, setBox] = useState<ModuleBox | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [hash, setHash] = useState('');
  const navigate = useNavigate();
  useEffect(() => {
    let active = true;
    setBox(null);
    if (session && id)
      void api<ModuleBox>('/modules/' + id)
        .then((b) => {
          if (active) setBox(b);
        })
        .catch((e) => {
          if (active) setError(errorText(e));
        });
    return () => {
      active = false;
    };
  }, [session, id]);
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
  async function confirm(transaction?: Hex) {
    if (!session || !box) return;
    setBox(
      await api<ModuleBox>(
        `/modules/${box.id}/confirm`,
        'POST',
        transaction ? { hash: transaction } : {},
        session.csrf,
      ),
    );
  }
  async function update(data: ModuleData, s: SessionInfo) {
    if (!box) return;
    setBox(
      await api<ModuleBox>('/modules/' + box.id, 'PATCH', { data, revision: box.revision }, s.csrf),
    );
  }
  return (
    <section className="container cloud-page">
      <h1>{t('Cloud rules and publication', '云端规则与发布')}</h1>
      <Link to="/app/modules">{t('My cloud boxes', '我的云端 Box')}</Link>
      {session ? (
        <Header session={session} onLogout={() => setSession(null)} />
      ) : loading ? (
        <p>{t('Checking session…', '核对登录…')}</p>
      ) : (
        <Login onLogin={setSession} />
      )}
      {error ? <p role="alert">{error}</p> : null}
      {box?.state === 'draft' && typeof location.state?.handoffError === 'string' ? (
        <p role="alert">
          {t(
            'The rules were copied, but preparation did not finish. Review this cloud draft and retry below.',
            '规则已复制到云端，但准备发布未完成。请核对这份云端草稿后在下方重试。',
          )}{' '}
          {location.state.handoffError}
        </p>
      ) : null}
      {box && session ? (
        <>
          <p>
            {t('Publication state', '发布状态')}：{box.state} · {box.receipt?.state ?? 'draft'}
          </p>
          <ModuleRules data={box.data} />
          {box.state === 'draft' ? (
            <>
              <ModuleEditor
                key={box.revision}
                tool={box.data.tool}
                initial={box.data}
                busy={busy}
                onSave={(data) => void run(() => update(data, session))}
              />
              <button
                className="button primary"
                disabled={
                  busy || state.status !== 'ready' || !state.config.capabilities.modulePublishing
                }
                onClick={() =>
                  void run(async () => {
                    setBox(
                      await api<ModuleBox>(
                        `/modules/${box.id}/prepare`,
                        'POST',
                        { revision: box.revision },
                        session.csrf,
                      ),
                    );
                  })
                }
              >
                {t('Freeze and prepare publication', '冻结规则并准备发布')}
              </button>
              <p>
                {t(
                  'Preparation freezes these rules. Signing is a separate wallet action.',
                  '准备后规则被冻结，钱包签名是单独一步。',
                )}
              </p>
            </>
          ) : null}
          {box.data.tool === 'rewards' && box.state !== 'published' ? (
            <p className="notice">
              {t(
                'Publishing funds the entire reward list in one MON transaction.',
                '发布时将通过一笔 MON 交易存入全部奖励。',
              )}
            </p>
          ) : null}
          {box.publication && box.state !== 'published' ? (
            <>
              <ModuleFunds
                key={box.publication.id}
                publication={box.publication.publication}
                creation={box.publication}
                paymentsEnabled={
                  box.data.tool === 'rewards' &&
                  state.status === 'ready' &&
                  state.config.capabilities.payments
                }
                onCreationChecked={confirm}
              />
              <div className="cloud-card">
                <label>
                  {t('Publication transaction hash (optional)', '发布交易哈希（选填）')}
                  <input value={hash} onChange={(e) => setHash(e.target.value)} />
                </label>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(() => confirm(hash.trim() ? (hash.trim() as Hex) : undefined))
                  }
                >
                  {t('Recover publication', '恢复发布记录')}
                </button>
              </div>
            </>
          ) : null}
          {box.state === 'published' ? (
            <Link className="button primary" to={'/box/' + box.publicId}>
              {box.data.tool === 'split'
                ? t('Next: open payment page', '下一步：打开付款页面')
                : t('Open verified public link', '打开已核验公开链接')}
            </Link>
          ) : null}
          <button
            className="button secondary"
            disabled={busy || state.status !== 'ready'}
            onClick={() =>
              void run(async () => {
                if (state.status !== 'ready') return;
                const local = await saveDraft(draftKey(state.config.environment), box.data);
                navigate('/app/module-drafts/' + local.id);
              })
            }
          >
            {t('Copy rules into a new local draft', '复制规则为新的本地草稿')}
          </button>
          <details className="cloud-card">
            <summary>{t('Original publication and recovery data', '原发布与恢复数据')}</summary>
            <textarea
              readOnly
              rows={8}
              value={JSON.stringify(box.publication ?? { data: box.data }, null, 2)}
            />
          </details>
        </>
      ) : null}
    </section>
  );
}
interface PublicBox {
  publication: ModulePublication;
  transactionHash: Hex;
  snapshot: ModuleSnapshot;
  paymentsEnabled: boolean;
}
export function PublicModulePage() {
  const { id } = useParams(),
    { t } = useApp(),
    [box, setBox] = useState<PublicBox | null>(null),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  const updateSnapshot = useCallback((snapshot: ModuleSnapshot) => {
    setBox((current) => (current ? { ...current, snapshot } : current));
  }, []);
  useEffect(() => {
    let active = true;
    setBox(null);
    setError('');
    void api<PublicBox>('/public/modules/' + id)
      .then((b) => {
        validatePublication(b.publication);
        if (active) setBox(b);
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [id, revision]);
  return (
    <section
      className="container cloud-page public-module-page"
      data-tool={box?.publication.data.tool}
    >
      <Link className="back-link" to="/app">
        {t('Back to my boxes', '返回我的 Box')}
      </Link>
      <div className="public-heading">
        <div>
          <p className="eyebrow">
            {box ? getTool(box.publication.data.tool)!.name : 'MonadBox'} ·{' '}
            {t('Verified payment rules', '已核验付款规则')}
          </p>
          <h1>{box?.publication.data.title ?? t('Payment rules', '付款规则')}</h1>
        </div>
        {box ? <span className="status-label">{statusLabel(box.snapshot.state, t)}</span> : null}
        <button
          className="button secondary public-refresh"
          onClick={() => setRevision((n) => n + 1)}
        >
          {t('Refresh verified rules', '刷新已核验规则')}
        </button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {!box && !error ? (
        <p>{t('Verifying original contract and transaction…', '核验原合约和交易…')}</p>
      ) : null}
      {box ? (
        <div className="public-box-layout">
          <div>
            <PublicOverview publication={box.publication} snapshot={box.snapshot}>
              {box.publication.data.tool === 'deliver' ||
              box.publication.data.tool === 'milestones' ? (
                <PrivateFiles publication={box.publication} />
              ) : null}
            </PublicOverview>
            <details className="cloud-card">
              <summary>{t('All fixed rules', '完整固定规则')}</summary>
              <ModuleRules data={box.publication.data} />
            </details>
            <details className="cloud-card">
              <summary>{t('Verified contract and recovery', '合约与恢复信息')}</summary>
              <p>Monad Testnet · MON · v{box.publication.deployment.version}</p>
              <code>{box.publication.deployment.address}</code>
              <p>
                {t('Original transaction', '原交易')}：<code>{box.transactionHash}</code>
              </p>
              <p>
                {t(
                  'Save this link to find your Box from another browser.',
                  '保存此链接，可在其他浏览器查找你的 Box。',
                )}
              </p>
            </details>
          </div>
          <div>
            <PublicAmount publication={box.publication} snapshot={box.snapshot} />
            <ModuleFunds
              publication={box.publication}
              paymentsEnabled={box.paymentsEnabled}
              onSnapshot={updateSnapshot}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}
