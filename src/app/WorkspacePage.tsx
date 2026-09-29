import { statusLabel } from './shared/status';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { formatUnits } from 'viem';
import { useApp } from './context';
import { useFundsWallet, WalletChoice } from './shared/FundsWallet';
import { Login, Header, useSession, errorText } from './shared/Session';
import { api } from './cloud/api';
import type { CloudBox, PublicGroup } from '../shared/cloud/model';
import type { ModuleBox, ModulePublication } from '../shared/modules/model';
import { draftKey, readDrafts } from '../shared/group/draft';
import { draftKey as moduleDraftKey, readDrafts as readModuleDrafts } from './modules/drafts';
import {
  collectRecords,
  inView,
  knownRow,
  readBookmarks,
  saveBookmark,
  verifyWorkspaceBox,
} from './shared/workspace';
import type { WorkspaceBox, WorkspaceView, KnownBox } from './shared/workspace';
import './cloud/cloud.css';
import './workspace.css';

export default function WorkspacePage() {
  const { state, t } = useApp();
  if (state.status !== 'ready')
    return (
      <section className="container cloud-page">
        <h1>{t('My boxes', '我的 Box')}</h1>
        <p role="status">{t('Waiting for configuration…', '等待配置…')}</p>
      </section>
    );
  return (
    <Workspace
      key={state.config.environment}
      environment={state.config.environment}
      cloud={state.config.capabilities.cloudGroups}
      modules={state.config.capabilities.cloudModules}
    />
  );
}
function Workspace({
  environment,
  cloud,
  modules,
}: {
  environment: string;
  cloud: boolean;
  modules: boolean;
}) {
  const { t } = useApp(),
    wallet = useFundsWallet(),
    { session, setSession, loading } = useSession(cloud || modules),
    navigate = useNavigate(),
    epoch = useRef(0);
  const [view, setView] = useState<WorkspaceView>('created'),
    [rows, setRows] = useState<WorkspaceBox[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [listing, setListing] = useState(true),
    [revision, setRevision] = useState(0),
    [link, setLink] = useState(''),
    [progress, setProgress] = useState('');
  useEffect(() => {
    const version = ++epoch.current;
    setRows([]);
    setListing(true);
    setError('');
    setProgress('');
    const result: WorkspaceBox[] = [],
      errors: string[] = [];
    const append = (read: () => WorkspaceBox[]) => {
      try {
        result.push(...read());
      } catch (e) {
        errors.push(errorText(e));
      }
    };
    append(() =>
      readDrafts(localStorage, draftKey(environment)).map((r) => ({
        id: 'local-v1:' + r.id,
        title: r.data.title,
        href: '/app/group-drafts/' + r.id,
        tool: 'Group V1',
        source: 'local',
        state: 'DRAFT',
        created: true,
        joined: false,
        pending: false,
        history: false,
      })),
    );
    append(() =>
      readModuleDrafts(moduleDraftKey(environment)).map((r) => ({
        id: 'local-module:' + r.id,
        title: r.data.title,
        href: '/app/module-drafts/' + r.id,
        tool: r.data.tool,
        source: 'local',
        state: 'DRAFT',
        created: true,
        joined: false,
        pending: false,
        history: false,
      })),
    );
    append(() => readBookmarks(localStorage, environment).map((r) => knownRow(r, wallet.actor)));
    if (wallet.actor) append(() => collectRecords(environment, wallet.actor!));
    const combine = (items: WorkspaceBox[]) => {
      const map = new Map<string, WorkspaceBox>();
      for (const r of items) {
        const old = map.get(r.id);
        map.set(
          r.id,
          old
            ? {
                ...old,
                ...r,
                created: old.created || r.created,
                joined: old.joined || r.joined,
                pending: old.pending || r.pending,
                history: old.history || r.history,
              }
            : r,
        );
      }
      return [...map.values()];
    };
    setRows(combine(result));
    setError(errors.join(' '));
    async function loadCloud() {
      const jobs: Promise<WorkspaceBox[]>[] = [];
      if (session && cloud)
        jobs.push(
          api<CloudBox[]>('/groups').then((boxes) =>
            boxes.map((b) =>
              b.state === 'published' && b.publication
                ? {
                    ...knownRow(
                      { kind: 'group-v1', publication: b.publication.intent },
                      wallet.actor,
                    ),
                    created: true,
                  }
                : {
                    id: 'cloud-v1:' + b.id,
                    title: b.data.title,
                    href: '/app/groups/' + b.id,
                    tool: 'Group V1',
                    source: 'cloud',
                    state: b.state.toUpperCase(),
                    created: true,
                    joined: false,
                    pending: b.state === 'prepared',
                    history: false,
                  },
            ),
          ),
        );
      if (session && modules)
        jobs.push(
          api<ModuleBox[]>('/modules').then((boxes) =>
            boxes.map((b) =>
              b.state === 'published' && b.publication
                ? {
                    ...knownRow(
                      { kind: 'module', publication: b.publication.publication },
                      wallet.actor,
                    ),
                    created: true,
                  }
                : {
                    id: 'cloud-module:' + b.id,
                    title: b.data.title,
                    href: '/app/modules/' + b.id,
                    tool: b.data.tool,
                    source: 'cloud',
                    state: b.state.toUpperCase(),
                    created: true,
                    joined: false,
                    pending: b.state === 'prepared',
                    history: false,
                  },
            ),
          ),
        );
      for (const settled of await Promise.allSettled(jobs))
        if (settled.status === 'fulfilled') result.push(...settled.value);
        else errors.push(errorText(settled.reason));
      if (epoch.current === version) {
        setRows(combine(result));
        setError(errors.join(' '));
        setListing(false);
      }
    }
    void loadCloud();
    const refresh = () => setRevision((v) => v + 1);
    window.addEventListener('storage', refresh);
    return () => {
      epoch.current = version + 1;
      window.removeEventListener('storage', refresh);
    };
  }, [environment, wallet.actor, session, cloud, modules, revision]);
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
  async function verify() {
    const actor = wallet.actor,
      version = epoch.current;
    if (!actor) return;
    const list = rows.filter((r) => r.known),
      updates = new Map<string, WorkspaceBox>();
    let index = 0,
      done = 0;
    async function worker() {
      while (index < list.length && epoch.current === version) {
        const row = list[index++]!;
        try {
          updates.set(row.id, await verifyWorkspaceBox(row, actor!));
        } catch {
          const { credit, locked, withdrawn, block, ...rest } = row;
          void credit;
          void locked;
          void withdrawn;
          void block;
          updates.set(row.id, {
            ...rest,
            state: 'UNVERIFIED',
            error: t(
              'Chain lookup unavailable; open the original link to retry.',
              '链上查询暂不可用，可打开原链接重试。',
            ),
          });
        }
        done++;
        if (epoch.current === version) setProgress(`${done} / ${list.length}`);
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    if (epoch.current === version) setRows((current) => current.map((r) => updates.get(r.id) ?? r));
  }
  async function restore() {
    const url = new URL(link.trim(), location.origin);
    const match = /^\/(b|box)\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (url.origin !== location.origin || url.search || url.hash || !match)
      throw Error('Paste a public link from this environment. / 请粘贴当前环境的公开链接。');
    let known: KnownBox;
    if (match[1] === 'b') {
      const p = await api<PublicGroup>('/public/groups/' + match[2]);
      known = { kind: 'group-v1', publication: p.intent };
    } else {
      const p = await api<{ publication: ModulePublication }>('/public/modules/' + match[2]);
      known = { kind: 'module', publication: p.publication };
    }
    await saveBookmark(environment, known);
    navigate(url.pathname);
  }
  const selected = rows.filter((r) => inView(r, view));
  const chainRows = rows.filter((r) => r.known);
  const amountsReady =
    !!wallet.actor && !listing && chainRows.every((r) => r.credit !== undefined && !r.error);
  const total = (field: 'credit' | 'locked') =>
    amountsReady
      ? formatUnits(
          chainRows.reduce((sum, r) => sum + BigInt(r[field] ?? '0'), 0n),
          18,
        )
      : '—';
  const pendingCount = rows.filter((r) => r.pending).length;
  return (
    <section className="container cloud-page workspace-page">
      <div className="page-heading">
        <div>
          <h1>{t('My boxes', '我的 Box')}</h1>
          <p>
            {t('Your agreements, payments and next steps.', '每一份约定，每一笔进展，都在这里。')}
          </p>
        </div>
        <Link className="button primary" to="/#tools">
          {t('Create Box', '创建 Box')}
        </Link>
      </div>
      <WalletChoice
        value={wallet}
        busy={busy}
        connect={() =>
          void run(async () => {
            await wallet.connect();
          })
        }
      />
      <div className="workspace-summary">
        <div>
          <span>{t('My claimable funds', '我的可领取款')}</span>
          <strong>
            {total('credit')} <small>MON</small>
          </strong>
          <p>{t('Withdraw to receive funds in your wallet', '提取后转入你的钱包')}</p>
        </div>
        <div>
          <span>{t('Funds held in tracked Boxes', '已记录 Box 的保留款')}</span>
          <strong>
            {total('locked')} <small>MON</small>
          </strong>
          <p>{t('Includes funds held for all participants', '包含这些 Box 全部参与者的保留款')}</p>
        </div>
        <div>
          <span>{t('Needs attention', '待处理')}</span>
          <strong>
            {pendingCount} <small>{t('Boxes', '项')}</small>
          </strong>
          <button className="text-link" onClick={() => setView('pending')}>
            {t('View next steps', '查看下一步')}
          </button>
        </div>
      </div>
      <div className="workspace-toolbar">
        <button
          className="button secondary"
          disabled={busy || listing || !wallet.actor}
          onClick={() => void run(verify)}
        >
          {busy ? t('Checking…', '核验中…') : t('Refresh balances', '刷新资金状态')}
        </button>
        <span className="muted small" role="status">
          {(progress ? `${t('Checked', '已核验')} ${progress}` : '') ||
            (amountsReady
              ? t('Amounts from verified chain records', '金额来自已核验链上记录')
              : t('Connect and refresh to verify amounts', '连接钱包并刷新后显示已核验金额'))}
        </span>
      </div>
      {pendingCount > 0 ? (
        <div className="notice attention-strip">
          <span>
            {t(
              'Some Boxes need your attention. Review their current state before acting.',
              '有 Box 等待你处理，请查看当前状态后继续。',
            )}
          </span>
          <button className="text-link" onClick={() => setView('pending')}>
            {t('View', '查看')}
          </button>
        </div>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      <div className="workspace-table-panel">
        <div className="tabs" aria-label={t('Box views', 'Box视图')}>
          {(
            [
              ['created', t('Created by me', '我创建的')],
              ['joined', t('Joined by me', '我参与的')],
              ['pending', t('Needs attention', '待处理')],
              ['claim', t('To claim', '可领取')],
              ['history', t('History', '历史')],
            ] as const
          ).map(([key, label]) => (
            <button key={key} aria-pressed={view === key} onClick={() => setView(key)}>
              {label}
            </button>
          ))}
        </div>
        {selected.length ? (
          <div className="workspace-table-scroll">
            <table className="workspace-table">
              <thead>
                <tr>
                  <th>Box</th>
                  <th>{t('Status', '状态')}</th>
                  <th>{t('My claimable funds', '我的可领取款')}</th>
                  <th>{t('Next step', '下一步')}</th>
                </tr>
              </thead>
              <tbody>
                {selected.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link to={row.href}>
                        <strong>{row.title}</strong>
                      </Link>
                      <p className="small muted">
                        {row.tool} ·{' '}
                        {row.source === 'local'
                          ? t('Local draft', '本地草稿')
                          : row.source === 'cloud'
                            ? t('Saved draft', '已保存草稿')
                            : t('On-chain', '链上 Box')}
                      </p>
                    </td>
                    <td>
                      <span className="status-label">{statusLabel(row.state, t)}</span>
                      {row.error ? <p className="field-error small">{row.error}</p> : null}
                    </td>
                    <td>
                      {row.credit !== undefined
                        ? `${formatUnits(BigInt(row.credit), 18)} MON`
                        : '—'}
                      {row.withdrawn !== undefined && BigInt(row.withdrawn) > 0n ? (
                        <p className="small muted">
                          {t('Transferred', '已转入钱包')} {formatUnits(BigInt(row.withdrawn), 18)}{' '}
                          MON
                        </p>
                      ) : null}
                      {row.block ? (
                        <p className="small muted">
                          {t('Block', '区块')} {row.block}
                        </p>
                      ) : null}
                    </td>
                    <td>
                      <Link className="text-link" to={row.href}>
                        {row.known
                          ? t('View actions', '查看操作')
                          : t('Continue editing', '继续编辑')}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="workspace-empty">
            <h2>{t('No Boxes here yet', '这里还没有 Box')}</h2>
            <p>
              {t(
                'Create your first Box, or open a shared link to join.',
                '创建你的第一个 Box，或打开分享链接参与合作。',
              )}
            </p>
            <Link className="text-link" to="/#tools">
              {t('Explore the six tools', '浏览六个工具')}
            </Link>
          </div>
        )}
      </div>
      <div className="workspace-secondary">
        <details className="cloud-card">
          <summary>{t('Cloud drafts and account', '云端草稿与账号')}</summary>
          {cloud ? (
            session ? (
              <Header session={session} onLogout={() => setSession(null)} />
            ) : loading ? (
              <p>{t('Loading…', '加载中…')}</p>
            ) : (
              <Login onLogin={setSession} />
            )
          ) : (
            <p>
              {t(
                'Cloud storage is not configured. Your local drafts are available.',
                '云端存储尚未配置，本地草稿可正常使用。',
              )}
            </p>
          )}
          <p>
            <Link className="text-link" to="/app/group-drafts">
              {t('Group drafts', '成团草稿')}
            </Link>{' '}
            ·{' '}
            <Link className="text-link" to="/app/module-drafts">
              {t('Other drafts', '其他草稿')}
            </Link>
          </p>
        </details>
        <details className="cloud-card">
          <summary>{t('Find a Box from its original link', '通过原链接找回 Box')}</summary>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(restore);
            }}
          >
            <label>
              {t('Original public link', '原公开链接')}
              <input
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="/box/…"
                required
              />
            </label>
            <button className="button secondary" disabled={busy}>
              {t('Verify and open', '核验并打开')}
            </button>
          </form>
          <p className="small muted">
            {t(
              'Records from another browser require their original links.',
              '查找其他浏览器中的参与记录，需要原公开链接。',
            )}
          </p>
        </details>
      </div>
      <p className="small muted">
        <Link to="/app/group-activity">{t('Group transaction recovery', '成团交易恢复')}</Link> ·{' '}
        <Link to="/app/module-activity">{t('Other transaction recovery', '其他交易恢复')}</Link>
      </p>
    </section>
  );
}
