/**
 * Check a photo right after it is picked, then let the person decide.
 *
 * - Shows "Checking…" while the pixels are measured (tens of milliseconds).
 * - Warnings are suggestions: "Use this photo" is always there, unless the
 *   photo is unusable (missing, or far too small).
 * - A photo that could not be measured is not a bad photo; it is saved as is.
 */
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Button,
  Image,
  Platform,
  Text,
  View,
} from 'react-native';
import type { PickerAsset, QualityReport } from '@molecare/photo-quality';
import { analyzer } from './expoAnalyzer';
import { photoRecord, type StoredPhoto } from './photoRecord';

interface Props {
  asset: PickerAsset & {
    uri: string;
    width: number;
    height: number;
    fileSize?: number;
  };
  fromCamera: boolean;
  onSave: (photo: StoredPhoto) => void;
  onRetake: () => void;
}

export function CheckPhotoScreen({
  asset,
  fromCamera,
  onSave,
  onRetake,
}: Props) {
  const [report, setReport] = useState<QualityReport | null>(null);

  useEffect(() => {
    let current = true;
    void analyzer
      .analyze({
        uri: asset.uri,
        width: asset.width,
        height: asset.height,
        fileSize: asset.fileSize,
      })
      .then((result) => {
        if (current) setReport(result);
      });
    return () => {
      current = false;
    };
  }, [asset]);

  const save = () => {
    if (!report) return;
    onSave(
      photoRecord(asset, report, fromCamera, {
        platform: Platform.OS,
        osVersion: String(Platform.Version),
        model: 'your device model here',
      })
    );
  };

  return (
    <View>
      <Image
        source={{ uri: asset.uri }}
        style={{ width: '100%', aspectRatio: 1 }}
      />
      {!report ? (
        <ActivityIndicator accessibilityLabel="Checking the photo" />
      ) : (
        <>
          {report.ok && <Text>This photo looks good.</Text>}
          {report.warnings.map((warning) => (
            <Text key={warning} accessibilityRole="alert">
              {warning}
            </Text>
          ))}
          {report.critical && (
            <Text>This photo can't be used. Please try another one.</Text>
          )}
          <Button title="Retake" onPress={onRetake} />
          <Button
            title="Use this photo"
            onPress={save}
            disabled={report.critical}
          />
        </>
      )}
    </View>
  );
}
