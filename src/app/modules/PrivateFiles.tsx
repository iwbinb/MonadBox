import { useEffect, useState } from 'react';
import { useApp } from '../context';
import { Login, Header, useSession, errorText } from '../shared/Session';
import { api } from '../cloud/api';
import {
  fileDigest,
  fileMetaSchema,
  validFileContent,
  FILE_LIMIT,
} from '../../shared/modules/files';
import type { PrivateFile } from '../../shared/modules/files';
import type { ModulePublication } from '../../shared/modules/model';
export function PrivateFiles({ publication: p }: { publication: ModulePublication }) {
  const { state, t } = useApp(),
    enabled = state.status === 'ready' && state.config.capabilities.privateFiles;
  return (
    <section className="cloud-card private-files">
      <h2>{t('Private delivery files', '私密交付文件')}</h2>
      {enabled ? (
        <Files publication={p} />
      ) : (
        <p>
          {t(
            'Private file storage is not enabled in this environment. Exchange files privately and keep their original copies; a delivery digest can still be submitted on-chain.',
            '本环境未开放私密文件存储。请私下交换并保留原件，仍可提交链上交付摘要。',
          )}
        </p>
      )}
    </section>
  );
}
function Files({ publication: p }: { publication: ModulePublication }) {
  const { t } = useApp(),
    { session, setSession, loading } = useSession(),
    [rows, setRows] = useState<PrivateFile[]>([]),
    [file, setFile] = useState<File | null>(null),
    [stageIndex, setStageIndex] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  const base = `/modules/${p.id}/files`,
    d = p.data,
    allowed =
      (d.tool === 'deliver' || d.tool === 'milestones') &&
      !!session &&
      [d.buyer, d.seller].some((a) => a.toLowerCase() === session.address.toLowerCase());
  useEffect(() => {
    let active = true;
    setRows([]);
    setError('');
    setFile(null);
    if (allowed)
      void api<PrivateFile[]>(base)
        .then((r) => {
          if (active) setRows(r);
        })
        .catch((e) => {
          if (active) setError(errorText(e));
        });
    return () => {
      active = false;
    };
  }, [base, allowed, session?.address, revision]);
  return (
    <>
      <details className="file-policy">
        <summary>{t('Private file access and limits', '文件权限与限制')}</summary>
        <p>
          {t(
            'Only the fixed buyer and seller may upload or download. Up to 5 files per delivery, 10 MiB each: UTF-8 .txt, .png or .jpg. Files may be removed 90 days after settlement; keep your own copies. Files are not malware-scanned; open only content you trust.',
            '仅固定客户和服务者可以上传或下载。每次交付最多5件，每件10 MiB，支持 UTF-8 .txt、.png 或 .jpg。结算90天后文件可能被清理，请自行保存。未提供恶意软件扫描，请只打开可信内容。',
          )}
        </p>
      </details>
      {session ? (
        <Header session={session} onLogout={() => setSession(null)} />
      ) : loading ? (
        <p>{t('Checking session…', '核对登录…')}</p>
      ) : (
        <Login onLogin={setSession} />
      )}
      {session && !allowed ? (
        <p>
          {t(
            'Sign in with this order’s buyer or seller wallet.',
            '请使用本订单的客户或服务者钱包登录。',
          )}
        </p>
      ) : null}
      {allowed ? (
        <>
          <ul className="cloud-list">
            {rows.map((r) => (
              <li key={r.id}>
                <div>
                  {r.state === 'ready' && r.mime !== 'text/plain' ? (
                    <PrivateImage
                      key={`${session.address}:${r.id}`}
                      file={r}
                      path={`/api/v1${base}/${r.id}`}
                    />
                  ) : null}
                  {r.name} · {(r.bytes / 1024).toFixed(1)} KiB{' '}
                  {d.tool === 'milestones' ? `· ${t('Stage', '阶段')} ${r.stageIndex + 1}` : ''}
                  <details>
                    <summary>{t('File integrity', '文件完整性')}</summary>
                    <code>{r.sha256}</code>
                  </details>
                  {r.state === 'ready' ? (
                    <a href={`/api/v1${base}/${r.id}`} download>
                      {t('Download with access check', '核验权限并下载')}
                    </a>
                  ) : (
                    <p>
                      {t(
                        'Upload reserved; choose the same file to retry.',
                        '已预留上传，请选择同一文件重试。',
                      )}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {d.tool === 'milestones' ? (
            <label>
              {t('File stage', '文件所属阶段')}
              <select
                aria-label={t('File stage', '文件所属阶段')}
                disabled={busy}
                value={stageIndex}
                onChange={(e) => {
                  setStageIndex(Number(e.target.value));
                  setFile(null);
                }}
              >
                {d.stages.map((s, index) => (
                  <option key={index} value={index}>
                    {index + 1}. {s.title}
                  </option>
                ))}
              </select>
              <small>
                {t(
                  'Only the current stage accepts new uploads. Earlier stage files remain readable by both parties.',
                  '仅当前阶段可新增文件，先前阶段文件仍可由双方读取。',
                )}
              </small>
            </label>
          ) : null}
          <label>
            {t('Choose a private file', '选择私密文件')}
            <input
              type="file"
              accept=".txt,.png,.jpg,.jpeg"
              disabled={busy}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <button
            className="button secondary"
            disabled={busy || !file}
            onClick={() => {
              if (!file || !session) return;
              setBusy(true);
              setError('');
              void (async () => {
                if (file.size > FILE_LIMIT)
                  throw Error(t('File exceeds 10 MiB.', '文件超过10 MiB。'));
                const body = await file.arrayBuffer(),
                  meta = fileMetaSchema.parse({
                    name: file.name,
                    mime: file.type,
                    bytes: file.size,
                    sha256: await fileDigest(body),
                    stageIndex,
                  });
                if (!validFileContent(body, meta.mime))
                  throw Error(
                    t(
                      'The contents do not match an allowed file type.',
                      '文件内容不符合允许的格式。',
                    ),
                  );
                // Recover a ready object or live reservation before creating a new upload request.
                const existing = await api<PrivateFile[]>(base);
                const reserved =
                  existing.find(
                    (r) =>
                      r.uploader.toLowerCase() === session.address.toLowerCase() &&
                      r.name === meta.name &&
                      r.mime === meta.mime &&
                      r.bytes === meta.bytes &&
                      r.sha256 === meta.sha256 &&
                      r.stageIndex === meta.stageIndex &&
                      (r.state === 'ready' || r.expiresAt > Date.now() / 1000),
                  ) ??
                  (await api<PrivateFile>(base, 'POST', meta, session.csrf, crypto.randomUUID()));
                if (reserved.state !== 'ready') {
                  const response = await fetch(`/api/v1${base}/${reserved.id}`, {
                    method: 'PUT',
                    credentials: 'same-origin',
                    headers: {
                      'Content-Type': meta.mime,
                      'X-CSRF-Token': session.csrf,
                      'X-MonadBox-Client': 'web',
                    },
                    body,
                  });
                  if (!response.ok)
                    throw Error(
                      t(
                        'Upload failed; refresh the list and retry the same file.',
                        '上传未完成，请刷新列表后重试同一文件。',
                      ),
                    );
                }
                setRevision((n) => n + 1);
              })()
                .catch((e) => setError(errorText(e)))
                .finally(() => setBusy(false));
            }}
          >
            {t('Upload this file to the private order', '上传此文件至私密订单')}
          </button>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => setRevision((n) => n + 1)}
          >
            {t('Refresh file list', '刷新文件列表')}
          </button>
        </>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </>
  );
}

function PrivateImage({ file, path }: { file: PrivateFile; path: string }) {
  const { t } = useApp(),
    [open, setOpen] = useState(false),
    [url, setUrl] = useState(''),
    [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let objectUrl = '';
    void (async () => {
      const response = await fetch(path, { credentials: 'same-origin', signal: controller.signal });
      if (!response.ok)
        throw Error('Unable to preview this private file. / 暂时无法预览此私密文件。');
      const body = await response.arrayBuffer();
      if (
        body.byteLength !== file.bytes ||
        (await fileDigest(body)) !== file.sha256 ||
        !validFileContent(body, file.mime)
      )
        throw Error('File verification failed. / 文件核验失败。');
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(new Blob([body], { type: file.mime }));
      setUrl(objectUrl);
    })().catch((e) => {
      if (!controller.signal.aborted) setError(errorText(e));
    });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [open, path, file.bytes, file.sha256, file.mime]);
  return (
    <div className="private-image-preview">
      {url ? <img src={url} alt={file.name} /> : null}
      <button
        type="button"
        className="button secondary"
        onClick={() => {
          setOpen(!open);
          setUrl('');
          setError('');
        }}
      >
        {open ? t('Close image preview', '关闭图片预览') : t('Preview image', '预览图片')}
      </button>
      {open && !url && !error ? <p>{t('Loading private image…', '正在读取私密图片…')}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
