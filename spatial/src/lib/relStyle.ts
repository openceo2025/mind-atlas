import type { RelationType } from '../types';
import { t, type MessageKey } from '../i18n';

export const REL_STYLE: Record<RelationType, { color: string; dash: string }> = {
  related: { color: '#4d8dff', dash: '' },
  source: { color: '#6ae3ff', dash: '2 5' },
  derived: { color: '#6ae3ff', dash: '7 5' },
  contains: { color: '#ffb347', dash: '1 6' },
  supports: { color: '#3ddc97', dash: '' },
  contradicts: { color: '#ff6b7a', dash: '' },
  'axis-of': { color: '#ffd166', dash: '' },
  'compared-with': { color: '#a98bff', dash: '9 4' },
};

export const relLabel = (type: RelationType) => t(`relation.${type}` as MessageKey);
