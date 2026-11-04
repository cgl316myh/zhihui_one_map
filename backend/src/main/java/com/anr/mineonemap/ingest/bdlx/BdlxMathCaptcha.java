package com.anr.mineonemap.ingest.bdlx;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Locale;

/**
 * 厂商验证码为彩色算术图，形如 6×8=? ，登录填的是<strong>计算结果</strong>（48 / -1 / 9）。
 */
final class BdlxMathCaptcha {

    /** 3x3 密度 + 宽高比，来自已标注样本 */
    private static final double[][] DIGIT_TPL = {
            {0.68, 0.57, 0.50, 0.12, 0.68, 0.65, 0.42, 0.62, 0.69, 0.64, 3},
            {0.67, 0.67, 0.35, 0.65, 0.58, 0.65, 0.19, 0.78, 0.26, 0.72, 4},
            {0.45, 0.45, 0.54, 0.54, 0.64, 0.39, 0.59, 0.54, 0.35, 0.84, 5},
            {0.15, 0.22, 0.40, 0.45, 0.61, 0.51, 0.67, 0.53, 0.34, 0.69, 5},
            {0.04, 0.64, 0.36, 0.54, 0.77, 0.44, 0.32, 0.68, 0.67, 0.88, 6},
            {0.67, 0.58, 0.48, 0.15, 0.48, 0.39, 0.42, 0.65, 0.02, 0.79, 7},
            {0.41, 0.60, 0.42, 0.52, 0.79, 0.72, 0.21, 0.66, 0.65, 0.79, 8},
            {0.42, 0.62, 0.52, 0.54, 0.71, 0.73, 0.35, 0.63, 0.63, 0.77, 8},
            {0.46, 0.75, 0.69, 0.36, 0.64, 0.66, 0.00, 0.13, 0.72, 0.88, 9},
            {0.68, 0.57, 0.50, 0.12, 0.68, 0.65, 0.42, 0.62, 0.69, 0.64, 3},
    };

    private BdlxMathCaptcha() {}

    static String solveDataUri(String dataUri) {
        if (dataUri == null || dataUri.isBlank()) {
            return null;
        }
        try {
            String b64 = dataUri;
            int comma = dataUri.indexOf(',');
            if (comma >= 0) {
                b64 = dataUri.substring(comma + 1);
            }
            byte[] bytes = Base64.getDecoder().decode(b64);
            BufferedImage img = ImageIO.read(new ByteArrayInputStream(bytes));
            if (img == null) {
                return null;
            }
            return eval(readExpression(img));
        } catch (Exception e) {
            return null;
        }
    }

    private static String readExpression(BufferedImage src) {
        int w = src.getWidth();
        int h = src.getHeight();
        boolean[][] ink = inkMask(src);
        int[] col = new int[w];
        for (int x = 0; x < w; x++) {
            int n = 0;
            for (int y = 0; y < h; y++) {
                if (ink[y][x]) {
                    n++;
                }
            }
            col[x] = n;
        }
        List<int[]> runs = verticalRuns(col);
        while (runs.size() < 5) {
            int wide = widestBefore(runs, 72);
            if (wide < 0) {
                break;
            }
            int[] r = runs.get(wide);
            List<int[]> sp = splitRun(col, r[0], r[1], h);
            if (sp.size() < 2) {
                break;
            }
            runs.remove(wide);
            runs.add(wide, sp.get(1));
            runs.add(wide, sp.get(0));
        }
        if (runs.size() < 3) {
            return null;
        }
        int take = Math.min(3, Math.max(0, runs.size() - 2));
        if (runs.size() >= 5) {
            take = 3;
        }
        StringBuilder expr = new StringBuilder();
        for (int i = 0; i < take; i++) {
            int[] r = runs.get(i);
            char ch = classify(ink, w, h, r[0], r[1], i == 1);
            if (ch == 0) {
                return null;
            }
            expr.append(ch);
        }
        return expr.toString();
    }

    private static boolean[][] inkMask(BufferedImage src) {
        int w = src.getWidth();
        int h = src.getHeight();
        boolean[][] m = new boolean[h][w];
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                int rgb = src.getRGB(x, y);
                int r = (rgb >> 16) & 0xff;
                int g = (rgb >> 8) & 0xff;
                int b = rgb & 0xff;
                int sat = Math.max(r, Math.max(g, b)) - Math.min(r, Math.min(g, b));
                int lum = (r + g + b) / 3;
                m[y][x] = sat > 25 && lum < 235;
            }
        }
        return m;
    }

    private static List<int[]> verticalRuns(int[] col) {
        List<int[]> out = new ArrayList<>();
        int i = 0;
        while (i < col.length) {
            if (col[i] == 0) {
                i++;
                continue;
            }
            int j = i;
            while (j < col.length && col[j] > 0) {
                j++;
            }
            if (j - i >= 3) {
                out.add(new int[]{i, j - 1});
            }
            i = j;
        }
        return out;
    }

    private static int widestBefore(List<int[]> runs, int xLimit) {
        int best = -1;
        int bestW = 0;
        for (int i = 0; i < runs.size(); i++) {
            int[] r = runs.get(i);
            if (r[0] >= xLimit) {
                continue;
            }
            int ww = r[1] - r[0] + 1;
            if (ww > bestW) {
                bestW = ww;
                best = i;
            }
        }
        return bestW >= 24 ? best : -1;
    }

    private static List<int[]> splitRun(int[] col, int a, int b, int h) {
        List<int[]> out = new ArrayList<>();
        int mx = 1;
        for (int x = a; x <= b; x++) {
            mx = Math.max(mx, col[x]);
        }
        int from = a + Math.max(6, (b - a) / 5);
        int to = b - Math.max(6, (b - a) / 5);
        int best = -1;
        int bestV = Integer.MAX_VALUE;
        for (int x = from; x <= to; x++) {
            if (col[x] < bestV) {
                bestV = col[x];
                best = x;
            }
        }
        if (best < 0) {
            best = a + (b - a) * 45 / 100;
        }
        if (best <= a + 4 || best >= b - 4) {
            out.add(new int[]{a, b});
            return out;
        }
        out.add(new int[]{a, best});
        out.add(new int[]{best + 1, b});
        return out;
    }

    private static char classify(boolean[][] ink, int w, int h, int x0, int x1, boolean asOp) {
        int minY = h, maxY = 0, minX = w, maxX = 0;
        for (int y = 0; y < h; y++) {
            for (int x = x0; x <= x1 && x < w; x++) {
                if (ink[y][x]) {
                    minY = Math.min(minY, y);
                    maxY = Math.max(maxY, y);
                    minX = Math.min(minX, x);
                    maxX = Math.max(maxX, x);
                }
            }
        }
        if (maxY < minY) {
            return 0;
        }
        double[] g = grid3(ink, minX, minY, maxX, maxY);
        int bw = maxX - minX + 1;
        int bh = maxY - minY + 1;
        double ar = bh == 0 ? 1 : (double) bw / bh;
        if (asOp || bh < h * 0.40) {
            char op = classifyOp(g, ar, bh, h);
            if (op != 0) {
                return op;
            }
        }
        return classifyDigit(g, ar);
    }

    private static char classifyOp(double[] g, double ar, int bh, int imgH) {
        double top = g[0] + g[1] + g[2];
        if (bh < imgH * 0.42 || top < 0.35) {
            return '-';
        }
        double mid = g[3] + g[4] + g[5];
        double v = g[1] + g[4] + g[7];
        if (mid > 1.6 && v > 1.4 && ar > 0.7 && ar < 1.4) {
            return '+';
        }
        return 'x';
    }

    private static char classifyDigit(double[] g, double ar) {
        if (ar < 0.40) {
            return '1';
        }
        if (g[8] < 0.12 && g[0] + g[1] + g[2] > 1.5) {
            return '7';
        }
        if (g[6] < 0.12 && g[8] > 0.45 && g[1] > 0.5) {
            return '9';
        }
        if (g[0] < 0.16 && g[7] > 0.5 && g[8] > 0.4) {
            return '6';
        }
        if (g[3] < 0.22 && g[5] > 0.45 && g[1] > 0.4) {
            return '3';
        }
        if (g[6] < 0.28 && g[7] > 0.65 && g[0] > 0.4) {
            return '4';
        }
        int bestD = -1;
        double best = 1e9;
        for (double[] t : DIGIT_TPL) {
            double d = 0;
            for (int i = 0; i < 9; i++) {
                double df = g[i] - t[i];
                d += df * df;
            }
            double da = ar - t[9];
            d += 0.35 * da * da;
            if (d < best) {
                best = d;
                bestD = (int) t[10];
            }
        }
        if (bestD >= 0 && best < 1.2) {
            return (char) ('0' + bestD);
        }
        if (g[4] > 0.68) {
            return '8';
        }
        return (char) ('0' + Math.max(0, bestD));
    }

    private static double[] grid3(boolean[][] ink, int x0, int y0, int x1, int y1) {
        double[] g = new double[9];
        int bw = x1 - x0 + 1;
        int bh = y1 - y0 + 1;
        int gi = 0;
        for (int gy = 0; gy < 3; gy++) {
            for (int gx = 0; gx < 3; gx++) {
                int xa = x0 + bw * gx / 3;
                int xb = x0 + bw * (gx + 1) / 3;
                int ya = y0 + bh * gy / 3;
                int yb = y0 + bh * (gy + 1) / 3;
                int tot = Math.max(1, (xb - xa) * (yb - ya));
                int n = 0;
                for (int y = ya; y < yb; y++) {
                    for (int x = xa; x < xb; x++) {
                        if (ink[y][x]) {
                            n++;
                        }
                    }
                }
                g[gi++] = (double) n / tot;
            }
        }
        return g;
    }

    static String eval(String raw) {
        if (raw == null) {
            return null;
        }
        String s = raw.toLowerCase(Locale.ROOT).replace(" ", "");
        s = s.replace('×', 'x').replace('*', 'x').replace('÷', '/').replace("?", "");
        int eq = s.indexOf('=');
        if (eq >= 0) {
            s = s.substring(0, eq);
        }
        for (char op : new char[]{'x', '/', '+', '-'}) {
            int i = op == '-' ? s.indexOf('-', 1) : s.indexOf(op);
            if (i <= 0) {
                continue;
            }
            try {
                int a = Integer.parseInt(s.substring(0, i));
                int b = Integer.parseInt(s.substring(i + 1));
                int r = switch (op) {
                    case '+' -> a + b;
                    case '-' -> a - b;
                    case 'x' -> a * b;
                    case '/' -> b == 0 ? Integer.MIN_VALUE : a / b;
                    default -> Integer.MIN_VALUE;
                };
                if (r == Integer.MIN_VALUE) {
                    continue;
                }
                return String.valueOf(r);
            } catch (Exception ignored) {
            }
        }
        return null;
    }
}
