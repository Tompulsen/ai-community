import { getExpectedNewApiUserId, newApiClient } from "../client/new-api";
import {
  refetchModels,
  refreshNewApiModels,
  refreshSelectedNewApiModels,
  useAccessStore,
} from "../store/access";
import { useAppConfig } from "../store/config";
import { getLocalTokenId } from "./local-workspace";
import { modelGroupType } from "./model-group";
import { getModelCapabilities } from "./model-capabilities";
import { CUSTOM_MODEL_PROVIDER } from "./custom-provider";
import type { RemixWork } from "./community-remix";

export const REMIX_MODEL_UNAVAILABLE =
  "无法调用该模型生成，请前往工作台切换模型！";
let preparing: Promise<unknown> = Promise.resolve();

/** Serialize selection only; each generation keeps its confirmed key afterward. */
export function prepareCommunityRemixModel(
  work: Pick<RemixWork, "kind" | "model">,
  check: () => void,
  requireModel = true,
) {
  const next = preparing
    .catch(() => {})
    .then(async () => {
      check();
      await useAccessStore.getState().fetch();
      check();
      if (useAccessStore.getState().switchingToken)
        throw new Error("模型分组正在切换，请稍后重试。");
      useAccessStore.setState({ switchingToken: true });
      const userId = getExpectedNewApiUserId();
      let selecting = false;
      const assertAccount = () => {
        check();
        if (getExpectedNewApiUserId() !== userId)
          throw new Error("创作账号已变化，请重新连接工作台。");
      };
      try {
        if (useAccessStore.getState().newApiEnabled && work.kind !== "text") {
          if (userId === null) throw new Error("请先连接创作账号。");
          let confirmedTokenId = getLocalTokenId();
          const source = await newApiClient.modelGroups(userId);
          assertAccount();
          if (getLocalTokenId() !== confirmedTokenId)
            throw new Error("模型分组已变化，请重试。");
          const matches = source.groups.filter(
            (group) => modelGroupType(group) === work.kind,
          );
          const group =
            matches.find((group) => group.id === source.selectedGroup) ??
            matches[0];
          if (!group) throw new Error(REMIX_MODEL_UNAVAILABLE);
          if (group.id !== source.selectedGroup) {
            selecting = true;
            const selected = await newApiClient.selectModelGroup(
              group.id,
              userId,
            );
            assertAccount();
            confirmedTokenId = selected.selectedTokenId;
            await refreshSelectedNewApiModels({
              userId,
              tokenId: selected.selectedTokenId,
              group: selected.group,
            });
            selecting = false;
          } else {
            await refreshNewApiModels(true);
          }
          assertAccount();
          if (getLocalTokenId() !== confirmedTokenId)
            throw new Error("模型分组已变化，请重试。");
          if (
            useAccessStore.getState().modelListStatus !== "ready" ||
            useAccessStore.getState().modelRefreshError
          )
            throw new Error("模型列表暂时无法读取，请稍后重试。");
          useAccessStore.setState({
            modelGroupType: modelGroupType(group),
            modelGroupTokenId: confirmedTokenId,
          });
        }
        assertAccount();
        const tokenId = getLocalTokenId();
        const model = useAppConfig
          .getState()
          .models.find(
            (item) =>
              item.available &&
              item.name === work.model.trim() &&
              item.provider.providerName !== CUSTOM_MODEL_PROVIDER,
          );
        const capabilities =
          model &&
          getModelCapabilities(model.name, model.provider.providerName);
        if (requireModel && (!model || capabilities?.category !== work.kind))
          throw new Error(REMIX_MODEL_UNAVAILABLE);
        return { model, capabilities, tokenId };
      } catch (error) {
        if (selecting && getExpectedNewApiUserId() === userId)
          await refetchModels();
        assertAccount();
        const message =
          error instanceof Error ? error.message : "模型分组读取失败。";
        throw new Error(
          message.includes(REMIX_MODEL_UNAVAILABLE)
            ? message
            : `${REMIX_MODEL_UNAVAILABLE}\n${message}`,
        );
      } finally {
        useAccessStore.setState({ switchingToken: false });
      }
    });
  preparing = next;
  return next;
}
