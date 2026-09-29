import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context';
import { setupKinds } from './deployment';
import type { SetupRow } from './deployment';
import { setupCheckError, setupNames, verifySetupRegistration } from './setup-registration';
import type { SetupProgress } from './setup-registration';

export function SetupRegistration({
  rows,
  disabled,
  onBusyChange,
}: {
  rows: SetupRow[];
  disabled: boolean;
  onBusyChange: (value: boolean) => void;
}) {
  const { t } = useApp();
  const [progress, setProgress] = useState<SetupProgress | null>(null),
    [checking, setChecking] = useState(false),
    [error, setError] = useState(''),
    [registry, setRegistry] = useState(''),
    [copyMessage, setCopyMessage] = useState('');
  const controller = useRef<AbortController | null>(null);
  const output = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    return () => {
      if (controller.current) {
        controller.current.abort();
        onBusyChange(false);
      }
    };
  }, [onBusyChange]);
  const ready = setupKinds.filter((kind) =>
    rows.some((row) => row.intent.kind === kind && row.state === 'finalized'),
  ).length;

  async function verify() {
    if (controller.current && !controller.current.signal.aborted) return;
    const active = new AbortController();
    controller.current = active;
    setChecking(true);
    onBusyChange(true);
    setError('');
    setRegistry('');
    setCopyMessage('');
    setProgress(null);
    try {
      const result = await verifySetupRegistration(rows, active.signal, setProgress);
      if (!active.signal.aborted) setRegistry(JSON.stringify(result, null, 2));
    } catch (e) {
      if (!active.signal.aborted) setError(e instanceof Error ? e.message : setupCheckError(e));
    } finally {
      if (!active.signal.aborted) {
        setChecking(false);
        onBusyChange(false);
        controller.current = null;
      }
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(registry);
      setCopyMessage(t('Configuration copied.', '配置已复制。'));
    } catch {
      output.current?.focus();
      output.current?.select();
      setCopyMessage(
        t(
          'Copy the selected JSON, or use Download JSON.',
          '请复制已选中的 JSON，或点击下载 JSON。',
        ),
      );
    }
  }

  return (
    <section className="cloud-card setup-export" aria-labelledby="setup-export-title">
      <h2 id="setup-export-title">{t('Export registration', '导出登记配置')}</h2>
      <p>
        {t('Verified deployments', '已核验部署')}：{ready}/7。
        {t(
          'Rechecks the existing contracts; no wallet signature or fee.',
          '重新读取已部署合约，无需钱包签名或手续费。',
        )}
      </p>
      {ready < 7 ? (
        <p>
          {t(
            'Use Recheck deployment in the history for each pending contract.',
            '请在部署记录中点击尚未完成合约的“核验部署”。',
          )}
        </p>
      ) : null}
      <button
        className="button primary"
        disabled={disabled || checking || ready !== 7}
        onClick={() => void verify()}
      >
        {checking
          ? t('Verifying contracts…', '正在核验合约…')
          : t('Verify and export registration', '核验并导出登记配置')}
      </button>
      {progress ? (
        <p role="status">
          {registry
            ? t(
                'Verification complete: 7/7. Copy or download the JSON below.',
                '核验完成：7/7。请复制或下载下方 JSON。',
              )
            : checking
              ? `${t('Verifying', '正在核验')} ${setupNames[progress.kind]} · ${progress.completed}/7 ${t('completed', '已完成')}`
              : `${t('Verification stopped', '核验已停止')} · ${progress.completed}/7 ${t('completed', '已完成')}`}
        </p>
      ) : null}
      {error ? (
        <div role="alert" className="setup-export-error">
          <p>{error}</p>
          <p>
            {t(
              'Your deployment records are retained. Retry verification; do not redeploy.',
              '部署记录已保留。请重新核验，无需重新部署。',
            )}
          </p>
        </div>
      ) : null}
      {registry ? (
        <>
          <h3>{t('Verified MON registration', '已核验 MON 配置')}</h3>
          <textarea
            ref={output}
            rows={14}
            readOnly
            aria-label={t('Verified registration JSON', '已核验配置 JSON')}
            value={registry}
          />
          <button className="button secondary" onClick={() => void copy()}>
            {t('Copy JSON', '复制 JSON')}
          </button>
          <a
            className="button secondary"
            href={`data:application/json;charset=utf-8,${encodeURIComponent(registry)}`}
            download="monadbox-registration.json"
          >
            {t('Download JSON', '下载 JSON')}
          </a>
          {copyMessage ? <p role="status">{copyMessage}</p> : null}
          <p>
            {t(
              'Send this JSON to finish registering the Production contracts and enable test MON payments.',
              '将这份 JSON 发给开发助手，完成线上合约登记并启用测试 MON 支付。',
            )}
          </p>
        </>
      ) : null}
    </section>
  );
}
