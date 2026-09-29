import { ToolIcon } from '../components';
import { useApp } from '../context';
import { getTool } from '../../shared/tools';
import type { ToolId } from '../../shared/tools';
import type { ReactNode } from 'react';
import { formatUnits } from 'viem';
import { parseAmount } from '../../shared/amount';
import { allocateSplit } from '../../shared/modules/terms';
export function EditorAside({
  tool,
  amount,
  label,
  rows,
  children,
  action,
}: {
  tool: ToolId;
  amount?: string;
  label?: string;
  rows?: { label: string; value: string }[];
  children?: ReactNode;
  action?: ReactNode;
}) {
  const { t, locale } = useApp(),
    definition = getTool(tool)!;
  return (
    <aside className="editor-aside">
      <span className="tool-icon">
        <ToolIcon id={tool} />
      </span>
      <h2>{t('Your agreement at a glance', '一眼看清这份约定')}</h2>
      {amount !== undefined ? (
        <div className="summary-amount">
          <span>{label ?? t('Full prepayment', '预付总额')}</span>
          <strong>
            {amount} <small>MON</small>
          </strong>
        </div>
      ) : null}
      {children}
      {rows?.length ? (
        <dl className="summary-rows">
          {rows.map((r, index) => (
            <div key={index}>
              <dt>{r.label}</dt>
              <dd>{r.value || t('To be added', '待填写')}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {tool !== 'split' ? (
        <>
          <p>{definition.scenario[locale]}</p>
          <ol>
            {definition.steps.map((s) => (
              <li key={s.en}>{s[locale]}</li>
            ))}
          </ol>
          <p>{definition.caution[locale]}</p>
          <hr />
          <p>
            {t(
              'All payments use Monad Testnet MON. Review your rules to see the participant view before saving.',
              '所有付款使用 Monad 测试网 MON。填写后点击预览规则，检查参与者将看到的内容。',
            )}
          </p>
        </>
      ) : null}
      {action}
    </aside>
  );
}
export function SplitAside({
  tool,
  amount,
  recipients,
}: {
  tool: ToolId;
  amount: string;
  recipients: { address: string; percent: string }[];
}) {
  const { t } = useApp();
  let shares: bigint[] | null = null;
  try {
    shares = allocateSplit(
      parseAmount(amount, 18),
      recipients.map((r) => Number(parseAmount(r.percent, 2))),
    );
  } catch {
    /* Invalid inputs have no calculated distribution. */
  }
  return (
    <EditorAside
      tool={tool}
      {...(tool === 'split'
        ? {}
        : { amount: shares ? formatUnits(parseAmount(amount, 18), 18) : '—' })}
      label={t('Example distribution', '分配金额（示例）')}
    >
      {shares ? (
        <div className="allocation-bar" aria-label={t('Percentage allocation', '比例分配')}>
          {recipients.map((r, i) => (
            <span key={i} style={{ flex: Number(r.percent) }}>
              {r.percent}%
            </span>
          ))}
        </div>
      ) : null}
      <dl className="summary-rows">
        {recipients.map((r, i) => (
          <div key={i}>
            <dt>
              {r.address
                ? `${r.address.slice(0, 6)}…${r.address.slice(-4)}`
                : `${t('Recipient', '收款人')} ${i + 1}`}
            </dt>
            <dd>
              {r.percent || '—'}%
              {tool !== 'split' ? ` · ${shares ? formatUnits(shares[i]!, 18) : '—'} MON` : ''}
            </dd>
          </div>
        ))}
      </dl>
    </EditorAside>
  );
}
