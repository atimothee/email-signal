import React from 'react';
import type { DailyBriefSection as Section } from '@schemas/index';
import { EmailPriorityCard } from './EmailPriorityCard';
import { ClutterSenderGroupCard } from './ClutterSenderGroupCard';

interface Props {
  section: Section;
}

export function DailyBriefSection({ section }: Props): JSX.Element {
  return (
    <section style={{ marginBottom: 16 }}>
      <h2 style={{ fontSize: 13, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.06, margin: '14px 0 6px' }}>
        {section.title}
      </h2>
      {section.summary && <p className="subtle">{section.summary}</p>}
      {section.items.map((item) => (
        <EmailPriorityCard key={item.emailId} finding={item} />
      ))}
      {section.clutterGroups.map((g) => (
        <ClutterSenderGroupCard key={g.senderDomain} group={g} />
      ))}
    </section>
  );
}
