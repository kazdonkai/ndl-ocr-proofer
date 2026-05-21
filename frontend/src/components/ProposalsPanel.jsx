import { useState } from 'react';
import { getImageUrl } from '../utils/imageUrl.js';

const VERDICT_LABEL = {
  accept: '適正',
  review: '要確認',
  reject: '要修正',
};

const VERDICT_CLASS = {
  accept: 'vd-accept',
  review: 'vd-review',
  reject: 'vd-reject',
};

function VerdictBadge({ verdict }) {
  return (
    <span className={`verdict-badge ${VERDICT_CLASS[verdict] ?? 'vd-review'}`}>
      {VERDICT_LABEL[verdict] ?? verdict}
    </span>
  );
}

export default function ProposalsPanel({ analyzedSpans, currentPageData, open, onToggle, onSpanClick, headless, hiraAllCount, onHiraAllNorm, acceptedCorrections }) {
  const [expandedId, setExpandedId] = useState(null);

  const items = analyzedSpans
    .filter(sp => sp.validation != null && (acceptedCorrections?.[sp.id] === undefined))
    .sort((a, b) => {
      const order = { reject: 0, review: 1, accept: 2 };
      return (order[a.validation.verdict] ?? 1) - (order[b.validation.verdict] ?? 1);
    });

  const imageRelativePath =
    currentPageData?.image_path || currentPageData?.image_name || null;
  const imageUrl = getImageUrl(imageRelativePath);

  const listContent = (
    <div className="proposals-list-wrapper">
      {hiraAllCount > 0 && (
        <button
          type="button"
          className="proposals-hira-all-btn"
          onClick={onHiraAllNorm}
          title="このページの全ひらがなをカタカナに一括変換します（確認ダイアログあり）"
        >
          <span className="proposals-hira-all-icon">あ→ア</span>
          <span className="proposals-hira-all-label">ひらがな全一括変換</span>
          <span className="proposals-hira-all-count">{hiraAllCount}文字</span>
        </button>
      )}
      {items.length === 0 ? (
        <div className="crp-empty">判定対象の語はありません</div>
      ) : (
        <div className="crp-list proposals-list">
          {items.map(sp => {
        const vr = sp.validation;
        const isExpanded = expandedId === sp.id;
        const hasDetail = vr.reason || vr.suggestion || vr.image_audit_required;

        return (
          <div
            key={sp.id}
            className={`proposals-item vd-border-${vr.verdict}`}
            onClick={() => {
              onSpanClick?.(sp.id);
              if (hasDetail) setExpandedId(isExpanded ? null : sp.id);
            }}
            title={hasDetail ? '詳細を表示' : 'エディタで表示'}
            style={{ cursor: 'pointer' }}
          >
            <div className="proposals-main-row">
              <span className="crp-suspect">{sp.suspect_span}</span>
              <VerdictBadge verdict={vr.verdict} />
            </div>

            {isExpanded && (
              <div className="proposals-detail">
                {vr.reason && (
                  <div className="proposals-reason">{vr.reason}</div>
                )}

                {vr.suggestion && (
                  <div className="proposals-suggestion">
                    <span className="proposals-suggestion-label">OCR正規化候補</span>
                    <span className="proposals-arrow">→</span>
                    <span className="proposals-candidate">{vr.suggestion.suggested_candidate}</span>
                    <span className="proposals-conf">
                      ({Math.round(vr.suggestion.suggestion_confidence * 100)}%)
                    </span>
                  </div>
                )}

                {vr.suggestion?.suggestion_reason && (
                  <div className="proposals-sugg-reason">{vr.suggestion.suggestion_reason}</div>
                )}

                {vr.image_audit_required && imageUrl && (
                  <a
                    className="proposals-image-link"
                    href={imageUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={e => e.stopPropagation()}
                  >
                    原画像を確認
                  </a>
                )}
                {vr.image_audit_required && !imageUrl && (
                  <span className="proposals-image-none">（原画像なし）</span>
                )}
              </div>
            )}
          </div>
          );
        })}
        </div>
      )}
    </div>
  );

  if (headless) {
    return listContent;
  }

  if (!open) {
    return (
      <button className="crp-expand-btn proposals-expand-btn" onClick={onToggle} title="判定パネルを表示">
        ≡
      </button>
    );
  }

  return (
    <div className="proposals-panel">
      <div className="crp-header">
        <span className="crp-title">
          判定{items.length > 0 ? ` (${items.length})` : ''}
        </span>
        <button className="crp-collapse-btn" onClick={onToggle} title="判定パネルを閉じる">‹</button>
      </div>
      {listContent}
    </div>
  );
}
