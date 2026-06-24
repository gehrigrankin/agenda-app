export interface BubbleData {
  id: string;
  parentId: string | null;
  title: string;
  isFolder?: boolean;
  emoji: string | null;
  color: string | null;
}

export interface BubbleNoteData {
  id: string;
  bubbleId: string;
  title: string;
  preview: string;
}
