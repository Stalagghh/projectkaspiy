// Russian texts for the audio analysis screen.

export const AUDIO_LABEL_RU: Record<string, string> = {
  boat_engine: 'Моторная лодка',
  gunshot: 'Выстрел',
  background: 'Фон',
};

export const QUALITATIVE_RU: Record<string, string> = {
  high: 'высокая уверенность',
  medium: 'средняя уверенность',
  low: 'низкая уверенность',
};

/** Messages for the error codes of POST /api/audio/classify. */
export const AUDIO_ERROR_RU: Record<string, string> = {
  empty_body: 'Файл пустой.',
  too_large: 'Файл больше 10 МБ. Обрежьте запись или выберите другой файл.',
  unsupported_type: 'Неподдерживаемый формат. Загрузите запись WAV, MP3, FLAC или OGG.',
  undecodable: 'Не удалось прочитать аудио или запись длиннее 60 секунд.',
  ml_timeout: 'Анализ занял слишком много времени. Попробуйте более короткую запись.',
  ml_unavailable: 'Сервис распознавания сейчас недоступен. Попробуйте позже.',
  ml_not_configured: 'Сервис распознавания не настроен на сервере.',
  ml_error: 'Сервис распознавания вернул ошибку. Попробуйте позже.',
  ml_invalid_response: 'Сервис распознавания вернул неожиданный ответ.',
  forbidden_origin: 'Запрос отклонён: отправьте файл со страницы приложения.',
};

export const ACCEPTED_EXTENSIONS = ['.wav', '.mp3', '.flac', '.ogg'] as const;
export const ACCEPT_ATTRIBUTE =
  '.wav,.mp3,.flac,.ogg,audio/wav,audio/x-wav,audio/mpeg,audio/flac,audio/ogg';
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
