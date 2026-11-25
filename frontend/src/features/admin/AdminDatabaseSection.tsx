import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Banner,
  Button,
  Panel,
  Tabs,
  Text,
  TextArea,
  TextField,
} from '../../components/ui';
import { apiClient, type DbQueryResultOut, type DbTableSummaryOut } from '../../lib/api/client';
import './AdminDatabaseSection.css';

const EMPTY_TABLES: DbTableSummaryOut[] = [];

export function AdminDatabaseSection({
  projectUuid,
  sqlConsoleEnabled,
}: {
  projectUuid: string | null;
  sqlConsoleEnabled: boolean;
}) {
  const queryClient = useQueryClient();
  const [selectedTable, setSelectedTable] = useState<string>('users');
  const [tab, setTab] = useState('browser');
  const [filterText, setFilterText] = useState('');
  const [sortCol, setSortCol] = useState<string>('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);

  const [sqlInput, setSqlInput] = useState(
    'SELECT username, full_name, is_active FROM users ORDER BY username ASC;',
  );
  const [sqlResult, setSqlResult] = useState<DbQueryResultOut | null>(null);
  const [sqlError, setSqlError] = useState<string | null>(null);
  const [sqlBusy, setSqlBusy] = useState(false);

  const tablesQuery = useQuery({
    queryKey: ['admin-db-tables', projectUuid],
    queryFn: () => apiClient.listDbTables(projectUuid),
    enabled: Boolean(projectUuid),
  });
  const tables = useMemo(() => tablesQuery.data ?? EMPTY_TABLES, [tablesQuery.data]);

  useEffect(() => {
    if (tables.length > 0 && !tables.some((t) => t.name === selectedTable)) {
      setSelectedTable(tables[0]!.name);
    }
  }, [tables, selectedTable]);

  const browseQuery = useQuery({
    queryKey: [
      'admin-db-browse',
      projectUuid,
      selectedTable,
      page,
      sortCol,
      sortDir,
      filterText,
    ],
    queryFn: () =>
      apiClient.browseDbTable(
        selectedTable,
        {
          page,
          pageSize: 50,
          sort: sortCol || undefined,
          sortDir,
          filter: filterText || undefined,
        },
        projectUuid,
      ),
    enabled: Boolean(projectUuid && selectedTable && tab === 'browser'),
  });

  const handleSort = (colName: string, redacted: boolean) => {
    if (redacted) return;
    if (sortCol === colName) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(colName);
      setSortDir('asc');
    }
    setPage(1);
  };

  const handleRunSql = async () => {
    setSqlError(null);
    setSqlBusy(true);
    try {
      const res = await apiClient.runDbQuery(sqlInput, projectUuid);
      setSqlResult(res);
      await queryClient.invalidateQueries({ queryKey: ['admin-audit', projectUuid] });
    } catch (err) {
      setSqlResult(null);
      setSqlError(err instanceof Error ? err.message : 'Query failed');
    } finally {
      setSqlBusy(false);
    }
  };

  const browse = browseQuery.data;

  return (
    <div className="org-db" data-ui="admin-database">
      <Banner severity="info">
        Read-only project.db connection (`mode=ro`, `PRAGMA query_only=ON`). Sensitive columns
        (`password_hash`, `token_hash`, `csrf_token`) are redacted and all reads are audit-logged.
      </Banner>

      <div className="org-db__layout">
        <aside className="org-db__tables" aria-label="Database tables">
          <div className="org-db__tables-hdr">
            <Text size="sm">Tables ({tables.length})</Text>
          </div>
          <div className="org-db__table-list">
            {tables.map((t) => (
              <button
                key={t.name}
                type="button"
                className={`org-db__table-btn ${selectedTable === t.name ? 'is-selected' : ''}`}
                onClick={() => {
                  setSelectedTable(t.name);
                  setSortCol('');
                  setPage(1);
                }}
              >
                <span className="org-db__table-name">{t.name}</span>
                <Badge tone="neutral">{t.row_count}</Badge>
              </button>
            ))}
          </div>
        </aside>

        <div className="org-db__main">
          <Tabs
            activeId={tab}
            onChange={setTab}
            items={[
              {
                id: 'browser',
                label: 'Table Browser',
                content: (
                  <Panel title={browse ? `${browse.table} (${browse.total} rows)` : selectedTable}>
                    <div className="org-db__toolbar">
                      <TextField
                        aria-label="Filter table rows"
                        placeholder="Filter non-redacted values…"
                        value={filterText}
                        onChange={(e) => {
                          setFilterText(e.target.value);
                          setPage(1);
                        }}
                      />
                      <div className="org-db__pager">
                        <Button
                          size="sm"
                          disabled={page <= 1}
                          onClick={() => setPage((p) => Math.max(1, p - 1))}
                        >
                          Prev
                        </Button>
                        <Text size="sm" variant="mono">
                          Page {page}
                        </Text>
                        <Button
                          size="sm"
                          disabled={!browse || page * browse.page_size >= browse.total}
                          onClick={() => setPage((p) => p + 1)}
                        >
                          Next
                        </Button>
                      </div>
                    </div>

                    {browse && (
                      <div className="org-admin-table-wrap">
                        <table className="org-admin-matrix" aria-label={`Table ${browse.table}`}>
                          <thead>
                            <tr>
                              {(browse.columns ?? []).map((col) => (
                                <th
                                  key={col.name}
                                  className="org-db__th"
                                  onClick={() => handleSort(col.name, col.redacted)}
                                >
                                  {col.name}
                                  {col.redacted ? ' [REDACTED]' : ''}
                                  {sortCol === col.name ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {(browse.rows ?? []).map((row, rIdx) => (
                              <tr key={rIdx}>
                                {row.map((cell, cIdx) => (
                                  <td key={cIdx}>
                                    {cell === '[REDACTED]' ? (
                                      <Badge tone="warning">[REDACTED]</Badge>
                                    ) : cell === null ? (
                                      'NULL'
                                    ) : (
                                      String(cell)
                                    )}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </Panel>
                ),
              },
              {
                id: 'sql',
                label: 'SQL Console',
                content: (
                  <Panel title="Read-Only SQL Console (SELECT / WITH only)">
                    {!sqlConsoleEnabled ? (
                      <Banner severity="warning">
                        SQL Console is disabled by default. Enable "Read-only admin SQL console" in
                        Project Settings to run SELECT queries.
                      </Banner>
                    ) : (
                      <div className="org-db__sql-box">
                        <TextArea
                          aria-label="Read-only SQL query"
                          rows={4}
                          value={sqlInput}
                          onChange={(e) => setSqlInput(e.target.value)}
                        />
                        <div className="org-db__toolbar">
                          <Button
                            size="sm"
                            variant="primary"
                            disabled={sqlBusy}
                            onClick={() => void handleRunSql()}
                          >
                            Run SELECT
                          </Button>
                          {sqlResult && (
                            <Text size="sm" variant="mono">
                              {sqlResult.row_count} rows · {sqlResult.elapsed_ms}ms
                              {sqlResult.truncated ? ' (capped at 1000 rows)' : ''}
                            </Text>
                          )}
                        </div>
                        {sqlError && <Banner severity="danger">{sqlError}</Banner>}
                        {sqlResult && (
                          <div className="org-admin-table-wrap">
                            <table className="org-admin-matrix" aria-label="SQL query results">
                              <thead>
                                <tr>
                                  {(sqlResult.columns ?? []).map((c, idx) => (
                                    <th key={`${c}-${idx}`}>{c}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {(sqlResult.rows ?? []).map((r, rIdx) => (
                                  <tr key={rIdx}>
                                    {r.map((cell, cIdx) => (
                                      <td key={cIdx}>
                                        {cell === '[REDACTED]' ? (
                                          <Badge tone="warning">[REDACTED]</Badge>
                                        ) : cell === null ? (
                                          'NULL'
                                        ) : (
                                          String(cell)
                                        )}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </Panel>
                ),
              },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
