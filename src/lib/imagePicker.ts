import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";

export const IMAGE_PICKER_MAX_BYTES = 5_242_880;

export const IMAGE_PICKER_MESSAGES = {
  permissionDenied: "Para escolher uma foto, permita o acesso às fotos nas configurações do aparelho.",
  tooLarge: "A imagem é muito grande. Escolha uma foto de até 5 MB.",
  generic: "Não foi possível selecionar a foto. Tente novamente.",
} as const;

export type PickedLibraryImage = {
  uri: string;
  mimeType: string;
  extension: string;
  fileSize: number;
};

export type PickImageFromLibraryOptions = {
  cropSquare: boolean;
};

export type ImagePickerErrorCode =
  | "permission-denied"
  | "too-large"
  | "unsupported"
  | "conversion-failed"
  | "failed";

export class ImagePickerSelectionError extends Error {
  readonly code: ImagePickerErrorCode;
  readonly userMessage: string;

  constructor(code: ImagePickerErrorCode, userMessage: string) {
    super(userMessage);
    this.name = "ImagePickerSelectionError";
    this.code = code;
    this.userMessage = userMessage;
  }
}

export function isImagePickerSelectionError(error: unknown): error is ImagePickerSelectionError {
  return error instanceof ImagePickerSelectionError;
}

export function imagePickerUserMessage(error: unknown): string {
  return isImagePickerSelectionError(error) ? error.userMessage : IMAGE_PICKER_MESSAGES.generic;
}

type LibraryPermission = {
  granted?: boolean;
  status?: string;
  accessPrivileges?: string | null;
};

type PickedAsset = {
  uri?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  type?: string | null;
};

type LibraryPickerResult = {
  canceled: boolean;
  assets?: PickedAsset[] | null;
};

type ImageManipulatorSaveResult = {
  uri?: string | null;
};

type ImageManipulatorHandle = {
  saveAsync: (options?: { format?: SaveFormat; compress?: number }) => Promise<ImageManipulatorSaveResult>;
  release?: () => void;
};

type ImageManipulatorContext = {
  renderAsync: () => Promise<ImageManipulatorHandle>;
  release?: () => void;
};

export type ImagePickerDependencies = {
  platform: string;
  getMediaLibraryPermissions: () => Promise<LibraryPermission>;
  requestMediaLibraryPermissions: () => Promise<LibraryPermission>;
  launchImageLibrary: (options: Record<string, unknown>) => Promise<LibraryPickerResult>;
  convertToJpeg: (uri: string) => Promise<string>;
  getFileSize: (uri: string) => Promise<number | null>;
};

export function getImageLibraryPickerOptions(cropSquare: boolean) {
  return {
    mediaTypes: ["images"] as const,
    allowsMultipleSelection: false,
    quality: 0.8,
    allowsEditing: cropSquare,
    ...(cropSquare ? { aspect: [1, 1] as [number, number] } : {}),
    legacy: false,
  };
}

export function isHeicLike(mimeType?: string | null, uri?: string | null, fileName?: string | null) {
  const mime = normalizeMime(mimeType);
  if (
    mime === "image/heic" ||
    mime === "image/heif" ||
    mime === "image/heic-sequence" ||
    mime === "image/heif-sequence" ||
    mime.startsWith("image/heic") ||
    mime.startsWith("image/heif")
  ) {
    return true;
  }

  const extension = fileExtension(fileName, uri);
  return extension === "heic" || extension === "heif";
}

export async function convertHeicToJpeg(
  uri: string,
  manipulator: { manipulate: (source: string) => ImageManipulatorContext } = ImageManipulator,
): Promise<string> {
  const context = manipulator.manipulate(uri);
  try {
    const image = await context.renderAsync();
    try {
      const saved = await image.saveAsync({
        format: SaveFormat.JPEG,
        compress: 0.8,
      });
      const nextUri = saved?.uri ?? "";
      if (!nextUri || nextUri === uri) {
        throw new ImagePickerSelectionError("conversion-failed", IMAGE_PICKER_MESSAGES.generic);
      }
      return nextUri;
    } finally {
      image.release?.();
    }
  } finally {
    context.release?.();
  }
}

export async function pickImageFromLibrary(
  options: PickImageFromLibraryOptions,
  deps: ImagePickerDependencies = createDefaultImagePickerDependencies(),
): Promise<PickedLibraryImage | null> {
  try {
    await ensureLibraryPermission(deps);

    const result = await deps.launchImageLibrary(getImageLibraryPickerOptions(options.cropSquare));
    if (result.canceled) return null;

    const asset = result.assets?.[0];
    if (!asset?.uri) {
      throw new ImagePickerSelectionError("failed", IMAGE_PICKER_MESSAGES.generic);
    }

    if (isRejectedDocument(asset)) {
      throw new ImagePickerSelectionError("unsupported", IMAGE_PICKER_MESSAGES.generic);
    }

    let uri = asset.uri;
    let mimeType = acceptedMimeType(asset.mimeType, uri, asset.fileName);
    let extension = extensionFromMime(mimeType);

    if (!mimeType || !extension) {
      throw new ImagePickerSelectionError("unsupported", IMAGE_PICKER_MESSAGES.generic);
    }

    if (isHeicLike(asset.mimeType, uri, asset.fileName)) {
      uri = await deps.convertToJpeg(uri);
      if (!uri || uri === asset.uri) {
        throw new ImagePickerSelectionError("conversion-failed", IMAGE_PICKER_MESSAGES.generic);
      }
      mimeType = "image/jpeg";
      extension = "jpg";
    }

    const fileSize = (await deps.getFileSize(uri)) ?? asset.fileSize ?? 0;
    if (fileSize > IMAGE_PICKER_MAX_BYTES) {
      throw new ImagePickerSelectionError("too-large", IMAGE_PICKER_MESSAGES.tooLarge);
    }

    return { uri, mimeType, extension, fileSize };
  } catch (error) {
    if (isImagePickerSelectionError(error)) throw error;
    throw new ImagePickerSelectionError("failed", IMAGE_PICKER_MESSAGES.generic);
  }
}

export function createDefaultImagePickerDependencies(): ImagePickerDependencies {
  return {
    platform: Platform.OS,
    getMediaLibraryPermissions: () => ImagePicker.getMediaLibraryPermissionsAsync(),
    requestMediaLibraryPermissions: () => ImagePicker.requestMediaLibraryPermissionsAsync(),
    launchImageLibrary: (options) => ImagePicker.launchImageLibraryAsync(options as ImagePicker.ImagePickerOptions),
    convertToJpeg: convertHeicToJpeg,
    getFileSize: getLocalFileSize,
  };
}

async function ensureLibraryPermission(deps: ImagePickerDependencies) {
  if (deps.platform !== "ios") return;

  const current = await deps.getMediaLibraryPermissions();
  if (hasLibraryAccess(current)) return;

  const requested = await deps.requestMediaLibraryPermissions();
  if (hasLibraryAccess(requested)) return;

  throw new ImagePickerSelectionError("permission-denied", IMAGE_PICKER_MESSAGES.permissionDenied);
}

function hasLibraryAccess(permission: LibraryPermission | null | undefined) {
  if (!permission) return false;
  if (permission.granted) return true;
  if (permission.status === "granted" || permission.status === "limited") return true;
  return permission.accessPrivileges === "limited" || permission.accessPrivileges === "all";
}

function isRejectedDocument(asset: PickedAsset) {
  const mime = normalizeMime(asset.mimeType);
  const extension = fileExtension(asset.fileName, asset.uri);
  if (asset.type && asset.type !== "image") return true;
  if (mime.startsWith("application/") || mime.startsWith("text/") || mime === "application/pdf") return true;
  return extension === "pdf" || extension === "csv" || extension === "txt" || extension === "doc" || extension === "docx";
}

function acceptedMimeType(mimeType?: string | null, uri?: string | null, fileName?: string | null) {
  if (isHeicLike(mimeType, uri, fileName)) return "image/heic";

  const mime = normalizeMime(mimeType);
  if (mime === "image/png") return "image/png";
  if (mime === "image/webp") return "image/webp";
  if (mime === "image/jpeg" || mime === "image/jpg") return "image/jpeg";

  const extension = fileExtension(fileName, uri);
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  return null;
}

function extensionFromMime(mimeType: string | null) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/heic") return "heic";
  return null;
}

function normalizeMime(mimeType?: string | null) {
  return (mimeType || "").split(";")[0].trim().toLowerCase();
}

function fileExtension(...values: (string | null | undefined)[]) {
  for (const value of values) {
    const path = (value || "").split("?")[0].split("#")[0];
    const match = path.match(/\.([a-z0-9]+)$/i);
    if (match?.[1]) return match[1].toLowerCase();
  }
  return null;
}

async function getLocalFileSize(uri: string): Promise<number | null> {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) return null;
  return "size" in info && typeof info.size === "number" ? info.size : null;
}
