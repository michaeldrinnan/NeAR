// File System Access API members not yet in TypeScript's DOM library.

type FsPermissionMode = 'read' | 'readwrite';

interface FileSystemHandle {
  queryPermission(desc?: { mode?: FsPermissionMode }): Promise<PermissionState>;
  requestPermission(desc?: { mode?: FsPermissionMode }): Promise<PermissionState>;
}

interface FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemFileHandle | FileSystemDirectoryHandle]>;
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  startIn?: FileSystemHandle | string;
  id?: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
}

interface Window {
  showDirectoryPicker?(options?: { id?: string; mode?: FsPermissionMode; startIn?: FileSystemHandle | string }): Promise<FileSystemDirectoryHandle>;
  showSaveFilePicker?(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>;
}
