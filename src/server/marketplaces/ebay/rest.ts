import { adapterError } from '../common';
import { ebayHosts, getAppToken, getUserAccessToken } from './auth';

export interface AspectDef { name: string; required: boolean; mode: 'FREE_TEXT' | 'SELECTION_ONLY'; multi: boolean; values: string[] }

const cache = new Map<string, { at: number; value: unknown }>();
const TTL = 24 * 3_600_000;
export function clearRestCache(): void { cache.clear(); }

async function get<T>(path: string, token: () => Promise<string>, cacheable = true): Promise<T> {
  const url = `${ebayHosts().rest}${path}`;
  const hit = cache.get(url);
  if (cacheable && hit && Date.now() - hit.at < TTL) return hit.value as T;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${await token()}`, Accept: 'application/json' } });
  const json = (await res.json().catch(() => ({}))) as T & { errors?: Array<{ message?: string }> };
  if (!res.ok) throw adapterError('API_ERROR', 'eBay', { detail: json.errors?.map((e) => e.message).filter(Boolean).join(' ') || `HTTP ${res.status}` });
  if (cacheable) cache.set(url, { at: Date.now(), value: json });
  return json;
}

export async function suggestCategories(q: string): Promise<Array<{ categoryId: string; name: string; path: string }>> {
  const json = await get<{ categorySuggestions?: Array<{ category: { categoryId: string; categoryName: string }; categoryTreeNodeAncestors?: Array<{ categoryName: string; categoryTreeNodeLevel: number }> }> }>(
    `/commerce/taxonomy/v1/category_tree/0/get_category_suggestions?q=${encodeURIComponent(q)}`, getAppToken);
  return (json.categorySuggestions ?? []).map((s) => {
    const ancestors = [...(s.categoryTreeNodeAncestors ?? [])].sort((a, b) => a.categoryTreeNodeLevel - b.categoryTreeNodeLevel).map((a) => a.categoryName);
    return { categoryId: s.category.categoryId, name: s.category.categoryName, path: [...ancestors, s.category.categoryName].join(' > ') };
  });
}

export async function getAspects(categoryId: string): Promise<AspectDef[]> {
  const json = await get<{ aspects?: Array<{
    localizedAspectName: string;
    aspectConstraint?: { aspectRequired?: boolean; aspectMode?: 'FREE_TEXT' | 'SELECTION_ONLY'; itemToAspectCardinality?: 'SINGLE' | 'MULTI' };
    aspectValues?: Array<{ localizedValue: string }>;
  }> }>(`/commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category?category_id=${encodeURIComponent(categoryId)}`, getAppToken);
  return (json.aspects ?? []).map((a) => ({
    name: a.localizedAspectName,
    required: a.aspectConstraint?.aspectRequired === true,
    mode: a.aspectConstraint?.aspectMode === 'SELECTION_ONLY' ? 'SELECTION_ONLY' : 'FREE_TEXT',
    multi: a.aspectConstraint?.itemToAspectCardinality === 'MULTI',
    values: (a.aspectValues ?? []).map((v) => v.localizedValue).slice(0, 300),
  }));
}

export async function getConditions(categoryId: string): Promise<Array<{ conditionId: number; label: string }>> {
  const json = await get<{ itemConditionPolicies?: Array<{ itemConditions?: Array<{ conditionId: string; conditionDescription: string }> }> }>(
    `/sell/metadata/v1/marketplace/EBAY_US/get_item_condition_policies?filter=categoryIds:%7B${encodeURIComponent(categoryId)}%7D`, getAppToken);
  return (json.itemConditionPolicies?.[0]?.itemConditions ?? []).map((c) => ({ conditionId: Number(c.conditionId), label: c.conditionDescription }));
}

type PolicyList = Array<{ id: string; name: string }>;
export async function getPolicies(): Promise<{ fulfillment: PolicyList; payment: PolicyList; return: PolicyList }> {
  const fetchPolicies = async (kind: 'fulfillment_policy' | 'payment_policy' | 'return_policy', key: string, idKey: string): Promise<PolicyList> => {
    const json = await get<Record<string, unknown>>(`/sell/account/v1/${kind}?marketplace_id=EBAY_US`, getUserAccessToken, false);
    return ((json[key] as Array<Record<string, string>> | undefined) ?? []).map((p) => ({ id: String(p[idKey]), name: String(p.name) }));
  };
  const [fulfillment, payment, ret] = await Promise.all([
    fetchPolicies('fulfillment_policy', 'fulfillmentPolicies', 'fulfillmentPolicyId'),
    fetchPolicies('payment_policy', 'paymentPolicies', 'paymentPolicyId'),
    fetchPolicies('return_policy', 'returnPolicies', 'returnPolicyId'),
  ]);
  return { fulfillment, payment, return: ret };
}
