import { reportSqlDelimiterProblems } from "./check-sql-delimiters.mjs";
process.exit(reportSqlDelimiterProblems() > 0 ? 1 : 0);
