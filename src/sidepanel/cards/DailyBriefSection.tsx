import React from 'react';
import type { DailyBriefSection as Section } from '@schemas/index';
import { EmailPriorityCard } from './EmailPriorityCard';
import { ClutterSenderGroupCard } from './ClutterSenderGroupCard';

interface Props {
  section: Section;
  onCorrectFinding?: (findingId: string, text: string) => void;
  onCorrectGroup?: (senderDomain: string, text: string) => void;
}

function sectionTone(kind: Section['kind']): string {
  switch (kind) {
    case 'needs_reply':
    case 'money':
    case 'scheduling':
      return 'warn';
    default:
      return '';
  }
}

export function DailyBriefSection({ section, onCorrectFinding, onCorrectGroup }: Props): JSX.Element {
  const tone = sectionTone(section.kind);
  const total = section.items.length + section.clutterGroups.length;
  if (total === 0) return <></>;

  return (
    <section style={{ marginBottom: 16 }}>
      <div className="section-label">
        <span>{section.title}</span>
        <span className={`count-badge ${tone}`}>{total}</span>
      </div>
      {section.summary && (
        <p className="subtle" style={{ marginTop: 0, marginBottom: 8 }}>
          {section.summary}
        </p>
      )}
      {section.items.map((item) => (
        <EmailPriorityCard
          key={item.emailId}
          finding={item}
          onCorrect={onCorrectFinding ? (t) => onCorrectFinding(item.emailId, t) : undefined}
        />
      ))}
      {section.clutterGroups.map((g) => (
        <ClutterSenderGroupCard
          key={g.senderDomain}
          group={g}
          onCorrect={onCorrectGroup ? (t) => onCorrectGroup(g.senderDomain, t) : undefined}
        />
      ))}
    </section>
  );
}
