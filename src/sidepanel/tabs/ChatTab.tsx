import React from 'react';
import { CopilotChat } from '@copilotkit/react-ui';
import '@copilotkit/react-ui/styles.css';
import { useGenerativeUiBindings } from '../copilot/actions';
import { ORCHESTRATOR_INSTRUCTIONS } from '../copilot/Provider';

const SUGGESTIONS = [
  { title: 'My priorities today?', message: 'What are my priorities today?' },
  { title: 'Unsubscribe ideas', message: 'What can I unsubscribe from?' },
  { title: 'Replies needed', message: 'Which emails do I need to reply to?' },
  { title: 'Payment reminders', message: 'Show me payment reminders.' },
  { title: 'Recap', message: 'What did you do today?' },
];

export function ChatTab(): JSX.Element {
  useGenerativeUiBindings();
  return (
    <div className="chat-tab">
      <CopilotChat
        instructions={ORCHESTRATOR_INSTRUCTIONS}
        suggestions={SUGGESTIONS}
        labels={{
          title: 'Email Signal',
          initial: "Ask about your inbox. I'll never act on it without showing you the action card first.",
          placeholder: 'Ask anything about your inbox…',
        }}
      />
    </div>
  );
}
