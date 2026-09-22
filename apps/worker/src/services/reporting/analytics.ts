// ============================================================
// Reporting Service — Question Analytics & Item Distribution
// ============================================================

import type { QuestionAnalyticsItem } from './types.ts';
import { getExamQuestionAnalytics } from '../exam-engine/analytics.ts';

export async function getConsolidatedAnalytics(
  db: D1Database,
  examId: string
): Promise<{ questions: QuestionAnalyticsItem[]; summary: { totalQuestions: number; totalSubmissions: number } }> {
  const raw = await getExamQuestionAnalytics(db, examId);

  const questions = raw.questions || [];
  const options = raw.options || [];
  const rows = raw.rows || [];

  // Group options by question_id
  const optionsByQ = new Map<string, any[]>();
  for (const opt of (options as any[])) {
    const qId = String(opt.question_id || '');
    if (!optionsByQ.has(qId)) optionsByQ.set(qId, []);
    optionsByQ.get(qId)!.push(opt);
  }

  // Count submissions and answer distributions
  const answersByQ = new Map<string, any[]>();
  const sessionSet = new Set<string>();
  for (const r of (rows as any[])) {
    const qId = String(r.question_id || '');
    if (!answersByQ.has(qId)) answersByQ.set(qId, []);
    answersByQ.get(qId)!.push(r);
    if (r.session_id) sessionSet.add(String(r.session_id));
  }

  const totalSubmissions = sessionSet.size;

  const resultQuestions: QuestionAnalyticsItem[] = questions.map((q: any) => {
    const qAnswers = answersByQ.get(q.id) || [];
    const qOpts = optionsByQ.get(q.id) || [];

    let answeredCount = 0;
    let correctCount = 0;
    let wrongCount = 0;
    const optionCounts = new Map<string, number>();

    for (const a of qAnswers) {
      if (a.answered) {
        answeredCount++;
        if (a.is_correct) correctCount++;
        else wrongCount++;
      }
      if (a.selected_option_id) {
        optionCounts.set(a.selected_option_id, (optionCounts.get(a.selected_option_id) || 0) + 1);
      }
    }

    const blankCount = Math.max(0, totalSubmissions - answeredCount);
    const correctRate = totalSubmissions > 0
      ? Math.round((correctCount / totalSubmissions) * 10000) / 100
      : 0;

    let difficulty: 'Mudah' | 'Sedang' | 'Sukar' = 'Sedang';
    if (correctRate >= 75) difficulty = 'Mudah';
    else if (correctRate < 35) difficulty = 'Sukar';

    const itemOptions = qOpts.map((o: any) => {
      const chosenCount = optionCounts.get(o.id) || 0;
      const chosenRate = totalSubmissions > 0
        ? Math.round((chosenCount / totalSubmissions) * 10000) / 100
        : 0;
      return {
        id: o.id,
        label: o.option_label || '',
        text: o.option_text || '',
        isCorrect: !!o.is_correct,
        chosenCount,
        chosenRate,
      };
    });

    return {
      id: q.id,
      order: Number(q.question_order || 0),
      text: q.question_text || '',
      type: q.question_type || 'multiple_choice',
      points: Number(q.points || 1),
      answeredCount,
      correctCount,
      wrongCount,
      blankCount,
      correctRate,
      difficulty,
      options: itemOptions,
    };
  });

  return {
    questions: resultQuestions,
    summary: {
      totalQuestions: questions.length,
      totalSubmissions,
    },
  };
}
