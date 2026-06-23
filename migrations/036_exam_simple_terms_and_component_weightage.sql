-- 036_exam_simple_terms_and_component_weightage.sql
--
-- Part 1: Relax exam_terms.term_type CHECK to allow 'term' (generic).
-- Part 2: Add weightage column to exam_components; backfill = max_marks
--         so existing raw-sum results are numerically preserved under the
--         new weighted formula: SUM(m/max*w)/SUM(w)*100.
--
-- Down:
--   ALTER TABLE exam_components DROP COLUMN weightage;
--   ALTER TABLE exam_terms DROP CONSTRAINT exam_terms_term_type_check;
--   ALTER TABLE exam_terms ADD CONSTRAINT exam_terms_term_type_check
--       CHECK (term_type IN ('unit_test','half_yearly','annual','practical','project','internal'));

-- Part 1: allow 'term' as a valid term_type
ALTER TABLE exam_terms DROP CONSTRAINT exam_terms_term_type_check;
ALTER TABLE exam_terms ADD CONSTRAINT exam_terms_term_type_check
    CHECK (term_type IN ('unit_test','half_yearly','annual','practical','project','internal','term'));

-- Part 2: component weightage
ALTER TABLE exam_components
    ADD COLUMN weightage NUMERIC(5,2) NOT NULL DEFAULT 100
    CHECK (weightage > 0);

UPDATE exam_components SET weightage = max_marks;
