import type { ModelType } from "../store";
import { DEFAULT_MASK_AVATAR } from "../store/mask";
import { Avatar } from "./emoji";

export function MaskAvatar(props: { avatar: string; model?: ModelType }) {
  return props.avatar !== DEFAULT_MASK_AVATAR ? (
    <Avatar avatar={props.avatar} />
  ) : (
    <Avatar model={props.model} />
  );
}
