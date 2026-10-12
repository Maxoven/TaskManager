import { createContext, useContext } from 'react';

// Текущий пользователь и способ обновить его данные (имя, фото) без повторного входа
const UserContext = createContext({ user: null, updateUser: () => {} });

export const UserProvider = UserContext.Provider;
export const useUser = () => useContext(UserContext);
