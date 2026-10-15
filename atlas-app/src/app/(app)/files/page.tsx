import { requireContext } from '@/server/context';
import { listSharedFiles, listSharedFileFolders } from '@/server/shared-files';
import { FilesClient } from './FilesClient';

export default async function SharedFilesPage() {
  const ctx = await requireContext();
  const [files, folders] = await Promise.all([
    listSharedFiles(ctx.scope),
    listSharedFileFolders(ctx.scope),
  ]);

  return (
    <FilesClient
      files={files.map((f) => ({
        id: f.id,
        fileName: f.fileName,
        fileSize: f.fileSize,
        mimeType: f.mimeType,
        folder: f.folder,
        description: f.description,
        url: f.url,
        uploadedAt: f.uploadedAt.toISOString(),
        uploadedByName: f.uploadedByName,
      }))}
      folders={folders}
      canEdit={ctx.permissions.has('settings.edit')}
      isSingleStore={ctx.scope.kind === 'single'}
    />
  );
}
