import { Inline, WorkflowNode } from '../types';

const t = (v: string): Inline => ({ t: 'text', v });
const a = (key: string): Inline => ({ t: 'action', key });
const step = (id: string, ...content: Inline[]): WorkflowNode => ({ id, type: 'step', content });

export interface Template { key: string; name: string; when_to_use: string; steps: WorkflowNode[] }

export const TEMPLATES: Template[] = [
  {
    key: 'order_refund',
    name: 'Order refund',
    when_to_use: 'Use when the customer wants their money back for an order they already paid for.',
    steps: [
      step('s1', t('Ask the customer for the order ID and the email or phone number on the order.')),
      step('s2', t('Use '), a('lookup_order'), t(' to find a matching order for those details.')),
      {
        id: 'b1', type: 'branch', cases: [
          { id: 'c1', kind: 'if', condition: [t('A matching order was found and it was delivered within the last 30 days')], steps: [
            step('s3', t('Ask which product from the order they want refunded and why.')),
            step('s4', t('Use '), a('refund_order'), t(' to refund the item to the original payment method.')),
            step('s5', t('Confirm the refunded amount and let the customer know it can take 5-10 business days to appear.')),
          ] },
          { id: 'c2', kind: 'else_if', condition: [t('A matching order was found but it was delivered more than 30 days ago')], steps: [
            step('s6', t('Explain that the order falls outside the 30-day refund window, then use '), a('escalate_to_human'), t(' so an agent can review the request.')),
          ] },
          { id: 'c3', kind: 'else', condition: [], steps: [
            step('s7', t('Tell the customer no order was found with those details and ask them to double-check the order ID and email or phone number.')),
          ] },
        ],
      },
    ],
  },
  {
    key: 'damaged_item_return',
    name: 'Damaged item return',
    when_to_use: 'Use when the customer received an item that arrived broken, cracked or damaged and wants a refund or return.',
    steps: [
      step('s1', t('Ask the customer for the order ID and the email or phone number on the order.')),
      step('s2', t('Use '), a('lookup_order'), t(' to find the order.')),
      {
        id: 'b1', type: 'branch', cases: [
          { id: 'c1', kind: 'if', condition: [t('The order was found and delivered within the last 30 days')], steps: [
            step('s3', t('Ask the customer for a clear photo of the damaged item.')),
            step('s4', t('Use '), a('request_approval'), t(' so the Returns team reviews the photo.')),
            {
              id: 'b2', type: 'branch', cases: [
                { id: 'c11', kind: 'if', condition: [t('The Returns team approved the photo')], steps: [
                  step('s5', t('Use '), a('refund_order'), t(' to refund the damaged item to the original payment method.')),
                  step('s6', t('Confirm the refunded amount and that it can take 5-10 business days to appear.')),
                ] },
                { id: 'c13', kind: 'else_if', condition: [t('The Returns team said the photo is unclear')], steps: [
                  { id: 'g1', type: 'goto', target: 's3', max_visits: 2 },
                ] },
                { id: 'c12', kind: 'else', condition: [], steps: [
                  step('s7', t("Explain the decision politely, using the reviewer's note.")),
                ] },
              ],
            },
          ] },
          { id: 'c2', kind: 'else_if', condition: [t('The order was found but delivered more than 30 days ago')], steps: [
            step('s8', t('Explain the 30-day window, then use '), a('escalate_to_human'), t(' so an agent can review it.')),
          ] },
          { id: 'c3', kind: 'else', condition: [], steps: [
            step('s9', t('Say no order was found and ask them to double-check the order ID and email.')),
          ] },
        ],
      },
    ],
  },
];
