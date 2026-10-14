import { buildTm30ImageHtml, buildTm30PdfHtml } from '../src/utils/tm30Report';

const spectrum = Array.from({ length: 401 }, (_, i) => ({ nm: 380 + i, value: 0.5 + 0.4 * Math.sin(i / 40) }));
const input: any = { spectrum, cct: 4485, duv: -0.0103, x: 0.3667, y: 0.3500, ra: 93, r9: 88, title: 'Test </script> light', takenAt: 0 };

describe('TM-30 image / PDF html', () => {
  it('image page embeds a script that parses and cannot be broken out of by the title', () => {
    const html = buildTm30ImageHtml(input);
    const m = html.match(/<script>([\s\S]*)<\/script>/);
    expect(m).toBeTruthy();
    expect(html.split('</script>').length).toBe(2);
    expect(() => new Function(m![1])).not.toThrow();
  });
  it('fluid PDF html fills the width, fixed html keeps 595px', () => {
    expect(buildTm30PdfHtml(input, true)).toContain('width:99.6%');
    expect(buildTm30PdfHtml(input)).toContain('width:595px');
  });
});
