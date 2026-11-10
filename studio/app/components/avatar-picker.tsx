import EmojiPicker, {
  EmojiStyle,
  Theme,
  type EmojiClickData,
} from "emoji-picker-react";

export function AvatarPickerContent(props: {
  onEmojiClick: (emojiId: string) => void;
}) {
  return (
    <EmojiPicker
      width={"100%"}
      lazyLoadEmojis
      theme={Theme.AUTO}
      emojiStyle={EmojiStyle.NATIVE}
      onEmojiClick={(event: EmojiClickData) => {
        props.onEmojiClick(event.unified);
      }}
    />
  );
}
