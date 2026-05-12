import * as path from 'path'
import * as fs from 'fs'
import { isPackagedApp } from '../utils/isPackagedApp'

export type LanguageCode = 'en_US' | 'vi_VN' | 'es_AR' | 'ja_JP' | 'ko_KR' | 'zh_CN' | 'ru_RU'

export const supportedLanguages = [
  { code: 'en_US' as const, name: 'English', flag: '🇺🇸' },
  { code: 'vi_VN' as const, name: 'Tiếng Việt', flag: '🇻🇳' },
  { code: 'es_AR' as const, name: 'Español (Argentina)', flag: '🇦🇷' },
  { code: 'ja_JP' as const, name: '日本語', flag: '🇯🇵' },
  { code: 'ko_KR' as const, name: '한국어', flag: '🇰🇷' },
  { code: 'zh_CN' as const, name: '简体中文', flag: '🇨🇳' },
  { code: 'ru_RU' as const, name: 'Русский', flag: '🇷🇺' }
]

interface Translation {
  [key: string]: string | Translation
}

class TranslationService {
  private static instance: TranslationService
  private currentLanguage: LanguageCode = 'en_US'
  private translations: Translation = {}

  private constructor() {
    this.loadTranslations(this.currentLanguage)
  }

  static getInstance(): TranslationService {
    if (!TranslationService.instance) {
      TranslationService.instance = new TranslationService()
    }
    return TranslationService.instance
  }

  private loadTranslations(language: LanguageCode): void {
    try {
      // Get the path to the locales in the renderer directory
      let localesPath: string

      if (isPackagedApp()) {
        // In production, translations should be in the renderer dist folder
        localesPath = path.join(__dirname, '../renderer/locales')
      } else {
        // In development, use the source locales from the project root
        localesPath = path.join(process.cwd(), 'src/renderer/src/locales')
      }

      const translationPath = path.join(localesPath, language, 'translation.json')

      if (fs.existsSync(translationPath)) {
        const data = fs.readFileSync(translationPath, 'utf-8')
        this.translations = JSON.parse(data)
      } else {
        console.warn(
          `Translation file not found at ${translationPath} for ${language}, falling back to English`
        )
        if (language !== 'en_US') {
          this.loadTranslations('en_US')
        }
      }
    } catch (error) {
      console.error('Failed to load translations:', error)
      this.translations = {}
    }
  }

  setLanguage(language: LanguageCode): void {
    this.currentLanguage = language
    this.loadTranslations(language)
  }

  getCurrentLanguage(): LanguageCode {
    return this.currentLanguage
  }

  t(key: string, fallback?: string): string {
    try {
      const keys = key.split('.')
      let value: any = this.translations

      for (const k of keys) {
        if (value && typeof value === 'object' && k in value) {
          value = value[k]
        } else {
          return fallback || key
        }
      }

      return typeof value === 'string' ? value : fallback || key
    } catch {
      return fallback || key
    }
  }
}

export const translationService = TranslationService.getInstance()
