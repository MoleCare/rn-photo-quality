// Just enough of React Native and Expo's types for the examples to typecheck
// without installing either. Apps use the real types.
declare module 'react-native' {
  import type { ComponentType, ReactNode } from 'react';

  export const Platform: {
    readonly OS: string;
    readonly Version: string | number;
  };
  export const View: ComponentType<{ style?: object; children?: ReactNode }>;
  export const Text: ComponentType<{
    style?: object;
    children?: ReactNode;
    accessibilityRole?: 'header' | 'text' | 'alert';
  }>;
  export const Image: ComponentType<{
    source: { uri: string };
    style?: object;
    accessibilityLabel?: string;
  }>;
  export const Button: ComponentType<{
    title: string;
    onPress: () => void;
    disabled?: boolean;
  }>;
  export const ActivityIndicator: ComponentType<{
    accessibilityLabel?: string;
  }>;
}

declare module 'expo-image-manipulator' {
  export enum SaveFormat {
    JPEG = 'jpeg',
    PNG = 'png',
  }
  export function manipulateAsync(
    uri: string,
    actions: { resize: { width?: number; height?: number } }[],
    options?: { base64?: boolean; format?: SaveFormat; compress?: number }
  ): Promise<{ uri: string; width: number; height: number; base64?: string }>;
}
