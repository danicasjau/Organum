import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  Banner,
  Button,
  Dialog,
  Icon,
  Spinner,
  Text,
  TextField,
} from '../../components/ui';
import { apiClient } from '../../lib/api/client';
import './FolderBrowserDialog.css';

export interface FolderBrowserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialPath?: string;
  onSelect: (path: string) => void;
  title?: string;
}

export function FolderBrowserDialog({
  open,
  onOpenChange,
  initialPath = '',
  onSelect,
  title = 'Select Server Directory',
}: FolderBrowserDialogProps) {
  const [browsePath, setBrowsePath] = useState(initialPath);
  const [pathDraft, setPathDraft] = useState(initialPath);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setBrowsePath(initialPath);
      setPathDraft(initialPath);
      setSelectedPath(null);
    }
  }, [open, initialPath]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['fs-browse', browsePath],
    queryFn: () => apiClient.browseFs(browsePath),
    enabled: open,
  });

  useEffect(() => {
    if (data?.current_path) {
      setPathDraft(data.current_path);
    }
  }, [data?.current_path]);

  const chosen = selectedPath ?? data?.current_path ?? pathDraft;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!chosen}
            onClick={() => {
              if (chosen) {
                onSelect(chosen);
                onOpenChange(false);
              }
            }}
          >
            Select Folder
          </Button>
        </>
      }
    >
      <div className="org-fbrowser">
        {data && (data.drives ?? []).length > 0 && (
          <div className="org-fbrowser__drives">
            {(data.drives ?? []).map((d) => (
              <Button
                key={d}
                size="sm"
                pressed={data.current_path.toUpperCase().startsWith(d.toUpperCase())}
                onClick={() => {
                  setBrowsePath(d);
                  setSelectedPath(null);
                }}
              >
                {d}
              </Button>
            ))}
          </div>
        )}

        <div className="org-fbrowser__pathbar">
          <Button
            size="sm"
            variant="icon"
            aria-label="Go up directory"
            disabled={!data?.parent_path}
            onClick={() => {
              if (data?.parent_path) {
                setBrowsePath(data.parent_path);
                setSelectedPath(null);
              }
            }}
          >
            <Icon name="arrow-up" size="sm" />
          </Button>
          <TextField
            value={pathDraft}
            aria-label="Directory path"
            onChange={(e) => setPathDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setBrowsePath(pathDraft);
                setSelectedPath(null);
              }
            }}
          />
          <Button
            size="sm"
            onClick={() => {
              setBrowsePath(pathDraft);
              setSelectedPath(null);
            }}
          >
            Go
          </Button>
        </div>

        {error && (
          <Banner severity="danger" title="Browse error">
            {error instanceof Error ? error.message : 'Unable to browse path'}
          </Banner>
        )}

        <div className="org-fbrowser__list" role="listbox" aria-label="Server directories">
          {isLoading ? (
            <Spinner label="Reading directory" />
          ) : (
            (data?.directories ?? []).map((dir) => (
              <button
                key={dir.path}
                type="button"
                role="option"
                aria-selected={selectedPath === dir.path}
                data-selected={selectedPath === dir.path ? 'true' : undefined}
                className="org-fbrowser__row"
                onClick={() => setSelectedPath(dir.path)}
                onDoubleClick={() => {
                  setBrowsePath(dir.path);
                  setSelectedPath(null);
                }}
              >
                <Icon name="folder" size="sm" />
                <span>{dir.name}</span>
              </button>
            ))
          )}
        </div>

        <Text size="sm" variant="mono" truncate>
          Selected: {chosen || '(none)'}
        </Text>
      </div>
    </Dialog>
  );
}

