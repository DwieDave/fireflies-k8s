// What kubectl's `-o json` holds, proven field by field (docs: Kubernetes'
// API reference). Each kind's guard proves only what the window reads; every
// field is nullable unless the window can't do without it, and a list is
// read item by item (lists.ts), so one object of another shape is left out,
// never the whole answer. Secrets are not here: their values never come in
// (kubectl.ts lists them by a template that prints key names only).

import type { Guarded } from "./guard.ts";
import { arrayOf, isBoolean, isNumber, isString, object } from "./guard.ts";
import { isNumberish, mapOf, maybe } from "./guards.ts";

const str = maybe(isString);
const num = maybe(isNumber);
const strMap = maybe(mapOf(isString));

/** An owner reference: the controller a pod or replica set belongs to. */
export const isOwnerRef = object({ kind: isString, name: isString }, { uid: str, controller: maybe(isBoolean) });

/** Every object's metadata. */
export const isMeta = object({ name: isString }, {
  namespace: str, uid: str, resourceVersion: str, creationTimestamp: str, deletionTimestamp: str,
  labels: strMap, annotations: strMap, ownerReferences: maybe(arrayOf(isOwnerRef)), generation: num,
});

export type Meta = Guarded<typeof isMeta>;

/** A status condition (Ready, Available, Progressing …). */
export const isCondition = object({ type: isString, status: isString }, { reason: str, message: str, lastTransitionTime: str });

export type Condition = Guarded<typeof isCondition>;

const conditions = maybe(arrayOf(isCondition));

// ---- pods

const isStateRunning = object({}, { startedAt: str });
const isStateWaiting = object({}, { reason: str, message: str });
const isStateTerminated = object({}, { reason: str, message: str, exitCode: num, finishedAt: str });
const isContainerState = object({}, { running: maybe(isStateRunning), waiting: maybe(isStateWaiting), terminated: maybe(isStateTerminated) });

export type ContainerState = Guarded<typeof isContainerState>;

export const isContainerStatus = object({ name: isString }, {
  ready: maybe(isBoolean), restartCount: num, image: str, started: maybe(isBoolean),
  state: maybe(isContainerState), lastState: maybe(isContainerState),
});

export type ContainerStatus = Guarded<typeof isContainerStatus>;

const isContainerPort = object({ containerPort: isNumber }, { name: str, protocol: str });

export type ContainerPort = Guarded<typeof isContainerPort>;

const isResources = object({}, { requests: strMap, limits: strMap });

export const isContainer = object({ name: isString }, { image: str, ports: maybe(arrayOf(isContainerPort)), resources: maybe(isResources) });

export type Container = Guarded<typeof isContainer>;

const isPodSpec = object({}, { nodeName: str, containers: maybe(arrayOf(isContainer)), initContainers: maybe(arrayOf(isContainer)) });

const isPodStatus = object({}, {
  phase: str, reason: str, message: str, podIP: str, startTime: str,
  containerStatuses: maybe(arrayOf(isContainerStatus)), initContainerStatuses: maybe(arrayOf(isContainerStatus)), conditions,
});

export const isPod = object({ metadata: isMeta }, { spec: maybe(isPodSpec), status: maybe(isPodStatus) });

export type Pod = Guarded<typeof isPod>;

// ---- workloads

const isSelector = object({}, { matchLabels: strMap });

export const isDeployment = object({ metadata: isMeta }, {
  spec: maybe(object({}, { replicas: num, selector: maybe(isSelector), paused: maybe(isBoolean) })),
  status: maybe(object({}, { replicas: num, readyReplicas: num, updatedReplicas: num, availableReplicas: num, unavailableReplicas: num, observedGeneration: num, conditions })),
});

export type Deployment = Guarded<typeof isDeployment>;

export const isReplicaSet = object({ metadata: isMeta }, {
  spec: maybe(object({}, { replicas: num, selector: maybe(isSelector) })),
  status: maybe(object({}, { replicas: num, readyReplicas: num, availableReplicas: num })),
});

export type ReplicaSet = Guarded<typeof isReplicaSet>;

export const isStatefulSet = object({ metadata: isMeta }, {
  spec: maybe(object({}, { replicas: num, serviceName: str, selector: maybe(isSelector) })),
  status: maybe(object({}, { replicas: num, readyReplicas: num, currentReplicas: num, currentRevision: str, updateRevision: str })),
});

export type StatefulSet = Guarded<typeof isStatefulSet>;

export const isDaemonSet = object({ metadata: isMeta }, {
  spec: maybe(object({}, { selector: maybe(isSelector) })),
  status: maybe(object({}, { desiredNumberScheduled: num, currentNumberScheduled: num, numberReady: num, numberAvailable: num, updatedNumberScheduled: num })),
});

export type DaemonSet = Guarded<typeof isDaemonSet>;

export const isJob = object({ metadata: isMeta }, {
  spec: maybe(object({}, { completions: num, parallelism: num, backoffLimit: num })),
  status: maybe(object({}, { active: num, succeeded: num, failed: num, startTime: str, completionTime: str, conditions })),
});

export type Job = Guarded<typeof isJob>;

const isJobRef = object({ name: isString }, { kind: str, namespace: str });

export const isCronJob = object({ metadata: isMeta }, {
  spec: maybe(object({}, { schedule: str, suspend: maybe(isBoolean) })),
  status: maybe(object({}, { lastScheduleTime: str, lastSuccessfulTime: str, active: maybe(arrayOf(isJobRef)) })),
});

export type CronJob = Guarded<typeof isCronJob>;

// ---- network

const isServicePort = object({ port: isNumber }, { name: str, protocol: str, targetPort: maybe(isNumberish), nodePort: num });

export type ServicePort = Guarded<typeof isServicePort>;

export const isService = object({ metadata: isMeta }, {
  spec: maybe(object({}, { type: str, clusterIP: str, ports: maybe(arrayOf(isServicePort)), selector: strMap, externalName: str })),
});

export type Service = Guarded<typeof isService>;

const isBackendPort = object({}, { number: num, name: str });
const isBackend = object({}, { service: maybe(object({ name: isString }, { port: maybe(isBackendPort) })) });
const isIngressPath = object({}, { path: str, pathType: str, backend: maybe(isBackend) });
const isIngressRule = object({}, { host: str, http: maybe(object({}, { paths: maybe(arrayOf(isIngressPath)) })) });

export type IngressRule = Guarded<typeof isIngressRule>;

export const isIngress = object({ metadata: isMeta }, {
  spec: maybe(object({}, { ingressClassName: str, rules: maybe(arrayOf(isIngressRule)), tls: maybe(arrayOf(object({}, { hosts: maybe(arrayOf(isString)) }))) })),
});

export type Ingress = Guarded<typeof isIngress>;

// ---- config and storage

export const isConfigMap = object({ metadata: isMeta }, { data: strMap, binaryData: strMap });

export type ConfigMap = Guarded<typeof isConfigMap>;

export const isPvc = object({ metadata: isMeta }, {
  spec: maybe(object({}, { storageClassName: str, volumeName: str, accessModes: maybe(arrayOf(isString)), resources: maybe(object({}, { requests: strMap })) })),
  status: maybe(object({}, { phase: str, capacity: strMap })),
});

export type Pvc = Guarded<typeof isPvc>;

// ---- cluster

const isNodeInfo = object({}, { kubeletVersion: str, osImage: str, architecture: str, containerRuntimeVersion: str });

export const isNode = object({ metadata: isMeta }, {
  spec: maybe(object({}, { unschedulable: maybe(isBoolean) })),
  status: maybe(object({}, { allocatable: strMap, capacity: strMap, conditions, nodeInfo: maybe(isNodeInfo), addresses: maybe(arrayOf(object({ type: isString, address: isString }))) })),
});

export type KNode = Guarded<typeof isNode>;

export const isNamespace = object({ metadata: isMeta }, { status: maybe(object({}, { phase: str })) });

export type Namespace = Guarded<typeof isNamespace>;

const isInvolved = object({ kind: isString, name: isString }, { namespace: str, uid: str });

export const isEvent = object({ metadata: isMeta, involvedObject: isInvolved }, {
  reason: str, message: str, type: str, count: num, firstTimestamp: str, lastTimestamp: str, eventTime: str,
});

export type KEvent = Guarded<typeof isEvent>;

/** Any object (a custom kind's): its metadata, and the status fields a generic row reads. */
export const isAnyObject = object({ metadata: isMeta }, { kind: str, status: maybe(object({}, { phase: str, conditions })) });

export type AnyObject = Guarded<typeof isAnyObject>;

/** The list kubectl prints for `get <kind> -o json`: its items still unproven. */
export const isKList = object({ items: (value: unknown): value is readonly unknown[] => Array.isArray(value) });
