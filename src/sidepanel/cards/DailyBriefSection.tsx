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
      <div className="section-label">{section.title}</div>
      {section.summary && <p className="subtle" style={{ marginTop: 0, marginBottom: 8 }}>{section.summary}</p>}
      {section.items.map((item) => (
        <EmailPriorityCard key={item.emailId} finding={item} />
      ))}
      {section.clutterGroups.map((g) => (
        <ClutterSenderGroupCard key={g.senderDomain} group={g} />
      ))}
    </section>
  );
}
