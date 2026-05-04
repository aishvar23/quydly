'use strict';

// Story-type module templates for the evidence-first pipeline.
// Each template defines the ordered sequence of editorial modules
// and narration guidance per slot. Module types map 1-to-1 to
// Remotion components in remotion/src/modules/.

const TEMPLATES = {
  legal_scandal: {
    description: 'Legal case / scandal / indictment',
    hook_rule:   'Lead with the most shocking specific fact — money amount, charge, or act',
    modules: [
      { type: 'HookStrap',        narration_hint: 'hook — one punchy sentence with the most surprising specific fact' },
      { type: 'DossierCard',      narration_hint: 'who is involved and what they did — subject, org, context' },
      { type: 'NumberCard',       narration_hint: 'the money or count figure with brief context' },
      { type: 'MapCallout',       narration_hint: 'where this happened or where the operations centered' },
      { type: 'ChargeCard',       narration_hint: 'the specific charges filed and by whom' },
      { type: 'WhyItMattersCard', narration_hint: 'the broader implication for national security, markets, or public trust' },
      { type: 'OutroLockup',      narration_hint: '' },
    ],
  },

  geopolitics_world: {
    description: 'Geopolitics / world news / diplomacy / conflict',
    hook_rule:   'Lead with the conflict, decision, or surprising geopolitical move',
    modules: [
      { type: 'HookStrap',        narration_hint: 'hook — the key event or development in one sentence' },
      { type: 'PersonCard',       narration_hint: 'the key figure — their role and what they did' },
      { type: 'MapCallout',       narration_hint: 'where this is happening and why the location matters' },
      { type: 'TimelineCard',     narration_hint: 'the sequence of events or escalation' },
      { type: 'WhyItMattersCard', narration_hint: 'the geopolitical implication' },
      { type: 'OutroLockup',      narration_hint: '' },
    ],
  },

  finance_markets: {
    description: 'Finance / markets / economics / corporate',
    hook_rule:   'Lead with the headline number or market move',
    modules: [
      { type: 'HookStrap',        narration_hint: 'hook — the number or market move' },
      { type: 'NumberCard',       narration_hint: 'the key metric in context' },
      { type: 'PlatformCard',     narration_hint: 'the company, market, or platform at the center of the story' },
      { type: 'MapCallout',       narration_hint: 'the affected region or market if location-relevant' },
      { type: 'WhyItMattersCard', narration_hint: 'the economic or market implication' },
      { type: 'OutroLockup',      narration_hint: '' },
    ],
  },

  tech_cyber: {
    description: 'Tech / cybersecurity / AI / digital',
    hook_rule:   'Lead with the product, breach, or capability that surprised people',
    modules: [
      { type: 'HookStrap',        narration_hint: 'hook — the tech event or discovery' },
      { type: 'PlatformCard',     narration_hint: 'the product or platform and what makes it significant' },
      { type: 'NumberCard',       narration_hint: 'the scale metric — users affected, data exposed, or capability number' },
      { type: 'WhyItMattersCard', narration_hint: 'the tech or security implication' },
      { type: 'OutroLockup',      narration_hint: '' },
    ],
  },

  general: {
    description: 'General news',
    hook_rule:   'Lead with the most specific, surprising element of the story',
    modules: [
      { type: 'HookStrap',        narration_hint: 'hook — one sentence that makes viewers stop' },
      { type: 'DossierCard',      narration_hint: 'context — who, what, where' },
      { type: 'WhyItMattersCard', narration_hint: 'the implication' },
      { type: 'OutroLockup',      narration_hint: '' },
    ],
  },
};

function getTemplate(storyType) {
  return TEMPLATES[storyType] || TEMPLATES.general;
}

module.exports = { TEMPLATES, getTemplate };
