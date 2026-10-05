import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  IMAGE_PICKER_MAX_BYTES,
  IMAGE_PICKER_MESSAGES,
  ImagePickerSelectionError,
  convertHeicToJpeg,
  getImageLibraryPickerOptions,
  pickImageFromLibrary,
  type ImagePickerDependencies,
} from "./imagePicker";

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-image-picker", () => ({
  getMediaLibraryPermissionsAsync: vi.fn(),
  requestMediaLibraryPermissionsAsync: vi.fn(),
  launchImageLibraryAsync: vi.fn(),
}));
vi.mock("expo-image-manipulator", () => ({
  ImageManipulator: { manipulate: vi.fn() },
  SaveFormat: { JPEG: "jpeg", PNG: "png" },
}));
vi.mock("expo-file-system/legacy", () => ({
  getInfoAsync: vi.fn(),
}));

function grantedPermission() {
  return { granted: true, status: "granted", accessPrivileges: "all" };
}

function deps(overrides: Partial<ImagePickerDependencies> = {}): ImagePickerDependencies {
  return {
    platform: "ios",
    getMediaLibraryPermissions: vi.fn(async () => grantedPermission()),
    requestMediaLibraryPermissions: vi.fn(async () => grantedPermission()),
    launchImageLibrary: vi.fn(async () => ({
      canceled: false,
      assets: [{ uri: "file:///photo.jpg", mimeType: "image/jpeg", fileName: "photo.jpg", fileSize: 1200, type: "image" }],
    })),
    convertToJpeg: vi.fn(async (uri) => `${uri}.converted.jpg`),
    getFileSize: vi.fn(async () => 1200),
    ...overrides,
  };
}

async function expectSelectionError(run: () => Promise<unknown>, code: string, message: string) {
  try {
    await run();
    throw new Error("expected ImagePickerSelectionError");
  } catch (error) {
    expect(error).toBeInstanceOf(ImagePickerSelectionError);
    expect(error).toMatchObject({ code, userMessage: message });
  }
}

describe("getImageLibraryPickerOptions", () => {
  it("crops the profile photo to a 1:1 square", () => {
    expect(getImageLibraryPickerOptions(true)).toEqual({
      mediaTypes: ["images"],
      allowsMultipleSelection: false,
      quality: 0.8,
      allowsEditing: true,
      aspect: [1, 1],
      legacy: false,
    });
  });

  it("opens the dream photo without a required crop", () => {
    expect(getImageLibraryPickerOptions(false)).toEqual({
      mediaTypes: ["images"],
      allowsMultipleSelection: false,
      quality: 0.8,
      allowsEditing: false,
      legacy: false,
    });
  });
});

describe("pickImageFromLibrary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts a JPEG from the library, including limited iOS access", async () => {
    const picked = await pickImageFromLibrary(
      { cropSquare: true },
      deps({
        getMediaLibraryPermissions: vi.fn(async () => ({
          granted: true,
          status: "granted",
          accessPrivileges: "limited",
        })),
      }),
    );
    expect(picked).toEqual({
      uri: "file:///photo.jpg",
      mimeType: "image/jpeg",
      extension: "jpg",
      fileSize: 1200,
    });
  });

  it("accepts a PNG from the library", async () => {
    const picked = await pickImageFromLibrary(
      { cropSquare: false },
      deps({
        launchImageLibrary: vi.fn(async () => ({
          canceled: false,
          assets: [{ uri: "file:///photo.png", mimeType: "image/png", fileName: "photo.png", fileSize: 2048, type: "image" }],
        })),
        getFileSize: vi.fn(async () => 2048),
      }),
    );
    expect(picked).toEqual({
      uri: "file:///photo.png",
      mimeType: "image/png",
      extension: "png",
      fileSize: 2048,
    });
  });

  it("accepts a WebP from the library", async () => {
    const picked = await pickImageFromLibrary(
      { cropSquare: false },
      deps({
        launchImageLibrary: vi.fn(async () => ({
          canceled: false,
          assets: [{ uri: "file:///photo.webp", mimeType: "image/webp", fileName: "photo.webp", fileSize: 1800, type: "image" }],
        })),
        getFileSize: vi.fn(async () => 1800),
      }),
    );
    expect(picked).toEqual({
      uri: "file:///photo.webp",
      mimeType: "image/webp",
      extension: "webp",
      fileSize: 1800,
    });
  });

  it("returns without an error when the user cancels", async () => {
    const picked = await pickImageFromLibrary(
      { cropSquare: true },
      deps({
        launchImageLibrary: vi.fn(async () => ({ canceled: true, assets: [] })),
      }),
    );
    expect(picked).toBeNull();
  });

  it("asks for library access and rejects when iOS permission is denied", async () => {
    const getMediaLibraryPermissions = vi.fn(async () => ({ granted: false, status: "denied", accessPrivileges: "none" }));
    const requestMediaLibraryPermissions = vi.fn(async () => ({ granted: false, status: "denied", accessPrivileges: "none" }));
    const launchImageLibrary = vi.fn(async () => ({ canceled: true }));

    await expectSelectionError(
      () => pickImageFromLibrary(
        { cropSquare: true },
        deps({ getMediaLibraryPermissions, requestMediaLibraryPermissions, launchImageLibrary }),
      ),
      "permission-denied",
      IMAGE_PICKER_MESSAGES.permissionDenied,
    );
    expect(requestMediaLibraryPermissions).toHaveBeenCalledTimes(1);
    expect(launchImageLibrary).not.toHaveBeenCalled();
  });

  it("rejects a missing image URI", async () => {
    await expectSelectionError(
      () => pickImageFromLibrary(
        { cropSquare: true },
        deps({
          launchImageLibrary: vi.fn(async () => ({
            canceled: false,
            assets: [{ mimeType: "image/jpeg", fileName: "photo.jpg" }],
          })),
        }),
      ),
      "failed",
      IMAGE_PICKER_MESSAGES.generic,
    );
  });

  it("converts HEIC to a real JPEG before returning", async () => {
    const convertToJpeg = vi.fn(async () => "file:///photo-converted.jpg");
    const picked = await pickImageFromLibrary(
      { cropSquare: false },
      deps({
        convertToJpeg,
        launchImageLibrary: vi.fn(async () => ({
          canceled: false,
          assets: [{ uri: "file:///photo.heic", mimeType: "image/heic", fileName: "photo.heic", fileSize: 4000, type: "image" }],
        })),
        getFileSize: vi.fn(async (uri) => (uri.endsWith("converted.jpg") ? 2100 : 4000)),
      }),
    );

    expect(convertToJpeg).toHaveBeenCalledWith("file:///photo.heic");
    expect(picked).toEqual({
      uri: "file:///photo-converted.jpg",
      mimeType: "image/jpeg",
      extension: "jpg",
      fileSize: 2100,
    });
  });

  it("converts HEIC-sequence MIME values to JPEG", async () => {
    const convertToJpeg = vi.fn(async () => "file:///sequence.jpg");
    const picked = await pickImageFromLibrary(
      { cropSquare: false },
      deps({
        convertToJpeg,
        launchImageLibrary: vi.fn(async () => ({
          canceled: false,
          assets: [{ uri: "file:///photo.heic", mimeType: "image/heic-sequence", fileName: "IMG_0001.HEIC", type: "image" }],
        })),
        getFileSize: vi.fn(async () => 1600),
      }),
    );

    expect(convertToJpeg).toHaveBeenCalledTimes(1);
    expect(picked?.mimeType).toBe("image/jpeg");
    expect(picked?.extension).toBe("jpg");
  });

  it("refuses the upload when HEIC conversion returns the original URI", async () => {
    await expectSelectionError(
      () => pickImageFromLibrary(
        { cropSquare: true },
        deps({
          convertToJpeg: vi.fn(async (uri) => uri),
          launchImageLibrary: vi.fn(async () => ({
            canceled: false,
            assets: [{ uri: "file:///photo.heif", mimeType: "image/heif", fileName: "photo.heif", type: "image" }],
          })),
        }),
      ),
      "conversion-failed",
      IMAGE_PICKER_MESSAGES.generic,
    );
  });

  it("rejects the final file when it is larger than 5 MB", async () => {
    await expectSelectionError(
      () => pickImageFromLibrary(
        { cropSquare: true },
        deps({
          getFileSize: vi.fn(async () => IMAGE_PICKER_MAX_BYTES + 1),
        }),
      ),
      "too-large",
      IMAGE_PICKER_MESSAGES.tooLarge,
    );
  });

  it("passes profile crop options to the library picker", async () => {
    const launchImageLibrary = vi.fn(async () => ({
      canceled: false,
      assets: [{ uri: "file:///avatar.jpg", mimeType: "image/jpeg", fileName: "avatar.jpg", fileSize: 900, type: "image" }],
    }));
    await pickImageFromLibrary({ cropSquare: true }, deps({ launchImageLibrary, getFileSize: vi.fn(async () => 900) }));
    expect(launchImageLibrary).toHaveBeenCalledWith(getImageLibraryPickerOptions(true));
  });

  it("passes dream options without a required aspect ratio", async () => {
    const launchImageLibrary = vi.fn(async () => ({
      canceled: false,
      assets: [{ uri: "file:///dream.jpg", mimeType: "image/jpeg", fileName: "dream.jpg", fileSize: 900, type: "image" }],
    }));
    await pickImageFromLibrary({ cropSquare: false }, deps({ launchImageLibrary, getFileSize: vi.fn(async () => 900) }));
    expect(launchImageLibrary).toHaveBeenCalledWith(getImageLibraryPickerOptions(false));
  });

  it("returns a valid selection ready for upload", async () => {
    const picked = await pickImageFromLibrary({ cropSquare: true }, deps());
    expect(picked).toMatchObject({
      uri: expect.stringMatching(/^file:/),
      mimeType: "image/jpeg",
      extension: "jpg",
    });
    expect(picked?.fileSize).toBeGreaterThan(0);
    expect(picked?.fileSize).toBeLessThanOrEqual(IMAGE_PICKER_MAX_BYTES);
  });

  it("rejects a document or PDF selection", async () => {
    await expectSelectionError(
      () => pickImageFromLibrary(
        { cropSquare: false },
        deps({
          launchImageLibrary: vi.fn(async () => ({
            canceled: false,
            assets: [{ uri: "file:///extrato.pdf", mimeType: "application/pdf", fileName: "extrato.pdf", type: "document" }],
          })),
        }),
      ),
      "unsupported",
      IMAGE_PICKER_MESSAGES.generic,
    );
  });

  it("uses the Android photo picker without requesting storage permission", async () => {
    const getMediaLibraryPermissions = vi.fn(async () => grantedPermission());
    const requestMediaLibraryPermissions = vi.fn(async () => grantedPermission());
    const launchImageLibrary = vi.fn(async () => ({
      canceled: false,
      assets: [{ uri: "file:///photo.jpg", mimeType: "image/jpeg", fileName: "photo.jpg", fileSize: 800, type: "image" }],
    }));

    await pickImageFromLibrary(
      { cropSquare: false },
      deps({
        platform: "android",
        getMediaLibraryPermissions,
        requestMediaLibraryPermissions,
        launchImageLibrary,
        getFileSize: vi.fn(async () => 800),
      }),
    );

    expect(getMediaLibraryPermissions).not.toHaveBeenCalled();
    expect(requestMediaLibraryPermissions).not.toHaveBeenCalled();
    expect(launchImageLibrary).toHaveBeenCalledWith(expect.objectContaining({ legacy: false, mediaTypes: ["images"] }));
  });
});

describe("convertHeicToJpeg", () => {
  it("renders and saves a new JPEG instead of renaming the extension", async () => {
    const saveAsync = vi.fn(async () => ({ uri: "file:///rendered.jpg" }));
    const releaseImage = vi.fn();
    const releaseContext = vi.fn();
    const renderAsync = vi.fn(async () => ({ saveAsync, release: releaseImage }));
    const manipulate = vi.fn(() => ({ renderAsync, release: releaseContext }));

    await expect(convertHeicToJpeg("file:///photo.heic", { manipulate })).resolves.toBe("file:///rendered.jpg");
    expect(manipulate).toHaveBeenCalledWith("file:///photo.heic");
    expect(renderAsync).toHaveBeenCalledTimes(1);
    expect(saveAsync).toHaveBeenCalledWith({ format: "jpeg", compress: 0.8 });
    expect(releaseImage).toHaveBeenCalledTimes(1);
    expect(releaseContext).toHaveBeenCalledTimes(1);
  });
});
