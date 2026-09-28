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
  return (
    <section className="container cloud-page workspace-page">
      <div className="page-heading">
        <div>
          <h1>{t('My boxes', '我的 Box')}</h1>
          <p>
            {t('Drafts, payments and the next step for your funds.', '草稿、付款与资金下一步。')}
          </p>
        </div>
        <Link className="button primary" to="/#tools">
          {t('Create a box', '创建 Box')}
        </Link>
      </div>
      <div className="workspace-start">
        <div className="cloud-card">
          <h2>{t('Your funds', '我的资金')}</h2>
          <WalletChoice
            value={wallet}
            busy={busy}
            connect={() =>
              void run(async () => {
                await wallet.connect();
              })
            }
          />
          <button
            className="button secondary"
            disabled={busy || listing || !wallet.actor}
            onClick={() => void run(verify)}
          >
            {t('Check chain rights', '核验链上权益')}
          </button>
          {progress ? (
            <p role="status">
              {t('Checked', '已核验')} {progress}
            </p>
          ) : null}
          <p className="small muted">
            {t(
              'Connect to load this browser’s records. Check rights to read current claimable credit; unchecked or failed reads never display zero.',
              '连接后加载本浏览器记录。核验权益后显示当前可领取款；未核验或查询失败不会显示为零。',
            )}
          </p>
        </div>
        <div className="cloud-card">
          <h2>{t('Saved in the cloud', '云端保存')}</h2>
          {cloud ? (
            session ? (
              <Header session={session} onLogout={() => setSession(null)} />
            ) : loading ? (
              <p>{t('Checking session…', '核对登录…')}</p>
            ) : (
              <Login onLogin={setSession} />
            )
          ) : (
            <p>
              {t(
                'Cloud is not enabled here. Local drafts remain available.',
                '本环境未启用云端，可继续使用本地草稿。',
              )}
            </p>
          )}
          <p>
            <Link to="/app/group-drafts">{t('Group drafts', '成团草稿')}</Link> ·{' '}
            <Link to="/app/module-drafts">{t('Payment drafts', '付款草稿')}</Link>
          </p>
        </div>
      </div>
      <form
        className="cloud-card"
        onSubmit={(e) => {
          e.preventDefault();
          void run(restore);
        }}
      >
        <label>
          {t('Restore from an original public link', '通过原公开链接恢复')}
          <input
            type="text"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="/box/…"
            required
          />
        </label>
        <button className="button secondary" disabled={busy}>
          {t('Verify and open link', '核验并打开链接')}
        </button>
        <p className="small muted">
          {t(
            'This list combines local records and your signed-in cloud creations. Another browser needs the original link to find participation; a missing row does not mean missing funds.',
            '本列表汇总本地记录和登录账号的云端创建记录。其他浏览器需用原链接查找参与权益；没有记录不代表没有资金。',
          )}
        </p>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      {rows.some((r) => r.known && r.credit === undefined) ? (
        <p role="status">
          {t(
            'Some amounts are unverified. Check chain rights or open each original link; this is not a zero balance.',
            '部分金额尚未核验。请核验权益或打开原链接，未核验不代表余额为零。',
          )}
        </p>
      ) : null}
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
      {view === 'claim' && !wallet.actor ? (
        <p role="status">
          {t(
            'Connect your funds wallet and check rights to find claimable credit.',
            '连接资金钱包并核验权益后查看可领取款。',
          )}
        </p>
      ) : null}
      <div className="workspace-grid">
        {selected.map((row) => (
          <article className="cloud-card" key={row.id}>
            <span className="status-label">
              {row.tool} ·{' '}
              {row.source === 'local'
                ? t('Local draft', '本地草稿')
                : row.source === 'cloud'
                  ? t('Cloud draft', '云端草稿')
                  : t('On-chain box', '链上 Box')}
            </span>
            <h2>
              <Link to={row.href}>{row.title}</Link>
            </h2>
            <p>{statusLabel(row.state, t)}</p>
            {row.credit !== undefined ? (
              <dl className="workspace-amounts">
                <dt>{t('My claimable credit', '我的可领取款')}</dt>
                <dd>{formatUnits(BigInt(row.credit), 6)} AUSD</dd>
                <dt>{t('My already transferred funds', '我的已转出款')}</dt>
                <dd>{formatUnits(BigInt(row.withdrawn!), 6)} AUSD</dd>
                <dt>{t('Total still held in this box', '该 Box 总保留款')}</dt>
                <dd>{formatUnits(BigInt(row.locked!), 6)} AUSD</dd>
              </dl>
            ) : row.known ? (
              <p>
                {t('Amounts have not been verified for this wallet.', '尚未核验当前钱包的金额。')}
              </p>
            ) : null}
            {row.block ? (
              <p className="small muted">
                {t('Verified block', '已核验区块')} {row.block}
              </p>
            ) : null}
            {row.error ? <p role="status">{row.error}</p> : null}
            <Link className="button secondary" to={row.href}>
              {row.known
                ? t('Open rules and actions', '查看规则与操作')
                : t('Continue draft', '继续编辑草稿')}
            </Link>
          </article>
        ))}
      </div>
      {!selected.length ? (
        <div className="cloud-card">
          <h2>{t('No matching records', '暂无符合条件的记录')}</h2>
          <p>
            {t(
              'Create a draft or restore an original public link. Claimable and actionable states require a chain check.',
              '可创建草稿或恢复原公开链接。可领取金额与当前可执行动作需要核验链上状态。',
            )}
          </p>
        </div>
      ) : null}
      <p>
        <Link to="/app/group-activity">{t('Group V1 recovery history', 'Group V1 恢复记录')}</Link>{' '}
        · <Link to="/app/module-activity">{t('Payment recovery history', '付款恢复记录')}</Link>
      </p>
    </section>
  );
}
