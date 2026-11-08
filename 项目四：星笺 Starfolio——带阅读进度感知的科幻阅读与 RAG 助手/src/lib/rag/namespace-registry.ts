export type NamespaceMapping = { issueWorkKey: string; contentVersion: string; namespace: string };

export function namespaceForVersion(mappings: NamespaceMapping[], issueWorkKey: string, contentVersion: string) {
  return mappings.find((item) => item.issueWorkKey === issueWorkKey && item.contentVersion === contentVersion)?.namespace;
}

export function namespacesForMappings(mappings: NamespaceMapping[]) {
  return [...new Set(mappings.map((item) => item.namespace))];
}
